import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { inspectInstalledDependenciesForLegacyUrlParse } from './legacy-url-parse-dependency-inspector.js';

const TRACE_RESULT_PREFIX = 'DEP0169_TRACE_RESULT=';
const MAX_CAPTURE_BYTES = 1024 * 1024;

function runNodeTrace({ rootDir, target, pendingDeprecation }) {
  const script = `
const { Discovery } = require('googleapis-common');
(async () => {
  try {
    await new Discovery({ debug: false, includePrivate: false }).discoverAPI(${JSON.stringify(target)});
    process.stdout.write(${JSON.stringify(TRACE_RESULT_PREFIX)} + JSON.stringify({ operationErrorCode: null }) + '\\n');
  } catch (error) {
    process.stdout.write(${JSON.stringify(TRACE_RESULT_PREFIX)} + JSON.stringify({ operationErrorCode: error && error.code ? String(error.code) : null }) + '\\n');
  }
})().catch(() => process.exitCode = 1);
`;

  const nodeArgs = ['--trace-deprecation'];
  if (pendingDeprecation) nodeArgs.push('--pending-deprecation');
  nodeArgs.push('-e', script);

  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, nodeArgs, {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    const append = (current, chunk) => {
      const next = current + String(chunk);
      if (Buffer.byteLength(next, 'utf8') > MAX_CAPTURE_BYTES) {
        child.kill();
        reject(new Error('DEP0169 runtime trace exceeded capture limit'));
        return current;
      }
      return next;
    };

    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`DEP0169 runtime trace child exited with code ${code}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

function parseTraceResult(stdout) {
  const line = String(stdout).split(/\r?\n/).find(value => value.startsWith(TRACE_RESULT_PREFIX));
  if (!line) throw new Error('DEP0169 runtime trace result marker missing');
  return JSON.parse(line.slice(TRACE_RESULT_PREFIX.length));
}

export async function traceGoogleapisCommonDiscoveryDep0169({
  rootDir = process.cwd(),
  pendingDeprecation = false
} = {}) {
  const root = resolve(rootDir);
  const staticReport = await inspectInstalledDependenciesForLegacyUrlParse({ rootDir: root });
  const candidates = staticReport.matches.filter(match => (
    match.packageName === 'googleapis-common'
    && /(?:^|\/)googleapis-common\/build\/src\/discovery\.js$/.test(match.path)
  ));
  if (candidates.length !== 1) {
    throw new Error(`expected exactly one googleapis-common discovery url.parse call-site, found ${candidates.length}`);
  }

  const staticMatch = candidates[0];
  const target = join(root, `.dep0169-runtime-trace-${process.pid}-${Date.now()}-missing.json`);
  const { stdout, stderr } = await runNodeTrace({
    rootDir: root,
    target,
    pendingDeprecation: pendingDeprecation === true
  });
  const operation = parseTraceResult(stdout);
  const normalizedTracePath = staticMatch.path.replaceAll('/', '[\\\\/]');
  const framePattern = new RegExp(`${normalizedTracePath}:${staticMatch.line}(?::\\d+)?`);

  return Object.freeze({
    triggerMode: 'missing-local-file',
    operationErrorCode: operation.operationErrorCode,
    warningCode: /\[DEP0169\]\s+DeprecationWarning/.test(stderr) ? 'DEP0169' : null,
    traceContainsStaticMatch: framePattern.test(stderr),
    staticMatch
  });
}
