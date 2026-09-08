import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const SOURCE_EXTENSIONS = Object.freeze(['.js', '.cjs', '.mjs']);
const IDENTIFIER = '[A-Za-z_$][\\w$]*';
const URL_MODULE = '(?:node:)?url';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceExtension(path) {
  return SOURCE_EXTENSIONS.find(extension => path.endsWith(extension)) || null;
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (source.charCodeAt(position) === 10) line += 1;
  }
  return line;
}

function lineExcerpt(source, index) {
  const start = source.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const endIndex = source.indexOf('\n', index);
  const end = endIndex === -1 ? source.length : endIndex;
  return source.slice(start, end).trim().slice(0, 240);
}

function addPatternMatches(matches, source, pattern) {
  for (const match of source.matchAll(pattern)) {
    matches.set(match.index, {
      line: lineNumberAt(source, match.index),
      excerpt: lineExcerpt(source, match.index)
    });
  }
}

function namedParseBindings(source) {
  const names = new Set();
  const importPattern = new RegExp(`import\\s*\\{([\\s\\S]*?)\\}\\s*from\\s*['\"]${URL_MODULE}['\"]`, 'g');
  for (const match of source.matchAll(importPattern)) {
    for (const part of match[1].split(',')) {
      const binding = part.trim().match(/^parse(?:\\s+as\\s+([A-Za-z_$][\\w$]*))?$/);
      if (binding) names.add(binding[1] || 'parse');
    }
  }

  const requirePattern = new RegExp(`(?:const|let|var)\\s*\\{([\\s\\S]*?)\\}\\s*=\\s*require\\(\\s*['\"]${URL_MODULE}['\"]\\s*\\)`, 'g');
  for (const match of source.matchAll(requirePattern)) {
    for (const part of match[1].split(',')) {
      const binding = part.trim().match(/^parse(?:\\s*:\\s*([A-Za-z_$][\\w$]*))?$/);
      if (binding) names.add(binding[1] || 'parse');
    }
  }
  return names;
}

function urlObjectBindings(source) {
  const names = new Set();
  const patterns = [
    new RegExp(`import\\s+\\*\\s+as\\s+(${IDENTIFIER})\\s+from\\s+['\"]${URL_MODULE}['\"]`, 'g'),
    new RegExp(`import\\s+(${IDENTIFIER})(?:\\s*,[\\s\\S]*?)?\\s+from\\s+['\"]${URL_MODULE}['\"]`, 'g'),
    new RegExp(`(?:const|let|var)\\s+(${IDENTIFIER})\\s*=\\s*require\\(\\s*['\"]${URL_MODULE}['\"]\\s*\\)`, 'g')
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  return names;
}

export function findLegacyNodeUrlParseCalls(source) {
  const text = String(source ?? '');
  if (!text) return [];
  const matches = new Map();

  addPatternMatches(matches, text, new RegExp(`require\\(\\s*['\"]${URL_MODULE}['\"]\\s*\\)\\s*\\.\\s*parse\\s*\\(`, 'g'));
  addPatternMatches(matches, text, new RegExp(`(?:await\\s+)?import\\(\\s*['\"]${URL_MODULE}['\"]\\s*\\)\\s*\\.\\s*parse\\s*\\(`, 'g'));

  for (const binding of urlObjectBindings(text)) {
    addPatternMatches(matches, text, new RegExp(`\\b${escapeRegExp(binding)}\\s*\\.\\s*parse\\s*\\(`, 'g'));
  }
  for (const binding of namedParseBindings(text)) {
    addPatternMatches(matches, text, new RegExp(`\\b${escapeRegExp(binding)}\\s*\\(`, 'g'));
  }

  return [...matches.values()].sort((left, right) => left.line - right.line || left.excerpt.localeCompare(right.excerpt));
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.bin' || entry.name === '.cache') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && sourceExtension(entry.name)) files.push(path);
  }
  return files;
}

function portableRelative(rootDir, file) {
  return relative(rootDir, file).split(sep).join('/');
}

function packageRootFor(file) {
  let current = dirname(file);
  while (current && current !== dirname(current)) {
    const parent = dirname(current);
    if (basename(parent) === 'node_modules') return current;
    if (basename(dirname(parent)) === 'node_modules' && basename(parent).startsWith('@')) return current;
    current = parent;
  }
  return null;
}

async function packageIdentity(packageRoot, cache) {
  if (!packageRoot) return { packageName: '(unknown)', packageVersion: '(unknown)' };
  if (!cache.has(packageRoot)) {
    cache.set(packageRoot, (async () => {
      try {
        const parsed = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
        return {
          packageName: String(parsed.name || basename(packageRoot)),
          packageVersion: String(parsed.version || '(unknown)')
        };
      } catch {
        return { packageName: basename(packageRoot), packageVersion: '(unknown)' };
      }
    })());
  }
  return cache.get(packageRoot);
}

export async function inspectInstalledDependenciesForLegacyUrlParse({ rootDir = process.cwd() } = {}) {
  const root = resolve(rootDir);
  const nodeModules = join(root, 'node_modules');
  let files;
  try {
    files = await sourceFiles(nodeModules);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return Object.freeze({ nodeModulesPresent: false, scannedFiles: 0, matches: Object.freeze([]) });
    }
    throw error;
  }

  const packageCache = new Map();
  const matches = [];
  let scannedFiles = 0;
  for (const file of files.sort()) {
    scannedFiles += 1;
    const source = await readFile(file, 'utf8');
    const calls = findLegacyNodeUrlParseCalls(source);
    if (calls.length === 0) continue;
    const identity = await packageIdentity(packageRootFor(file), packageCache);
    for (const call of calls) {
      matches.push(Object.freeze({
        ...identity,
        path: portableRelative(root, file),
        line: call.line,
        excerpt: call.excerpt
      }));
    }
  }

  matches.sort((left, right) => left.packageName.localeCompare(right.packageName)
    || left.packageVersion.localeCompare(right.packageVersion)
    || left.path.localeCompare(right.path)
    || left.line - right.line);

  return Object.freeze({
    nodeModulesPresent: true,
    scannedFiles,
    matches: Object.freeze(matches)
  });
}
