import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const RUNTIME_DIRECTORIES = Object.freeze(['api', 'lib']);
const SELF_PATH = 'lib/legacy-url-parse-regression-guard.js';
const IDENTIFIER = '[A-Za-z_$][\\w$]*';
const URL_MODULE = '(?:node:)?url';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsNamedParseBinding(bindings) {
  return String(bindings || '')
    .split(',')
    .map(part => part.trim())
    .some(part => /^parse(?:\s+as\s+[A-Za-z_$][\w$]*)?$/.test(part));
}

function hasNamedParseImport(source) {
  const pattern = new RegExp(`import\\s*\\{([\\s\\S]*?)\\}\\s*from\\s*['\"]${URL_MODULE}['\"]`, 'g');
  for (const match of source.matchAll(pattern)) {
    if (containsNamedParseBinding(match[1])) return true;
  }
  return false;
}

function hasDestructuredParseRequire(source) {
  const pattern = new RegExp(`(?:const|let|var)\\s*\\{([\\s\\S]*?)\\}\\s*=\\s*require\\(\\s*['\"]${URL_MODULE}['\"]\\s*\\)`, 'g');
  for (const match of source.matchAll(pattern)) {
    if (containsNamedParseBinding(match[1].replace(/:/g, ' as '))) return true;
  }
  return false;
}

function collectUrlObjectBindings(source) {
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

function hasBoundParseCall(source) {
  for (const binding of collectUrlObjectBindings(source)) {
    const pattern = new RegExp(`\\b${escapeRegExp(binding)}\\s*\\.\\s*parse\\s*\\(`);
    if (pattern.test(source)) return true;
  }
  return false;
}

export function detectLegacyNodeUrlParse(source) {
  const text = String(source ?? '');
  if (!text) return false;

  const directRequire = new RegExp(`require\\(\\s*['\"]${URL_MODULE}['\"]\\s*\\)\\s*\\.\\s*parse\\s*\\(`);
  const dynamicImport = new RegExp(`(?:await\\s+)?import\\(\\s*['\"]${URL_MODULE}['\"]\\s*\\)\\s*\\)?\\s*\\.\\s*parse\\s*\\(`);

  return directRequire.test(text)
    || dynamicImport.test(text)
    || hasNamedParseImport(text)
    || hasDestructuredParseRequire(text)
    || hasBoundParseCall(text);
}

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}

function portableRelative(rootDir, file) {
  return relative(rootDir, file).split(sep).join('/');
}

export async function scanLegacyNodeUrlParse({
  rootDir = process.cwd(),
  runtimeDirectories = RUNTIME_DIRECTORIES
} = {}) {
  const root = resolve(rootDir);
  const violations = [];

  for (const directory of runtimeDirectories) {
    const base = resolve(root, directory);
    for (const file of await javascriptFiles(base)) {
      const path = portableRelative(root, file);
      if (path === SELF_PATH) continue;
      const source = await readFile(file, 'utf8');
      if (detectLegacyNodeUrlParse(source)) violations.push(path);
    }
  }

  return violations.sort();
}
