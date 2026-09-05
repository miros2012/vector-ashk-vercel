const OWNER_ID = 46207692;
const READY_PREFIX = '[agent-ready]';
const IN_PROGRESS_PREFIX = '[agent-in-progress]';
const MAX_FILES = 6;
const MAX_OUTPUT = 12_000;
const SAFE_ROOTS = ['lib/', 'test/', 'docs/'];
const BLOCKED_EXACT_PATHS = new Set([
  'package.json',
  'package-lock.json',
  'vercel.json',
  '.env',
  '.env.local'
]);

function text(value) {
  return String(value ?? '').trim();
}

function validateSafePath(value) {
  const path = text(value).replace(/\\/g, '/');
  if (!path) throw new Error('allowed file path is required');
  if (path.startsWith('/') || path.includes('\0') || path.split('/').includes('..')) {
    throw new Error(`unsafe file path: ${path}`);
  }
  if (!SAFE_ROOTS.some((root) => path.startsWith(root))) {
    throw new Error(`file path is outside safe roots: ${path}`);
  }
  if (path.startsWith('.github/') || path.startsWith('api/') || path.startsWith('scripts/')) {
    throw new Error(`file path is not allowed: ${path}`);
  }
  if (BLOCKED_EXACT_PATHS.has(path) || /(^|\/)(?:\.env|secrets?)(?:\.|\/|$)/i.test(path)) {
    throw new Error(`file path is not allowed: ${path}`);
  }
  return path;
}

function uniquePaths(paths, label) {
  const normalized = paths.map(validateSafePath);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicate paths`);
  }
  return normalized;
}

export function selectReadyIssue(issues = [], { ownerId = OWNER_ID } = {}) {
  const candidates = (Array.isArray(issues) ? issues : [])
    .filter((issue) => !issue?.pull_request)
    .filter((issue) => Number(issue?.user?.id) === Number(ownerId))
    .filter((issue) => text(issue?.title).startsWith(READY_PREFIX))
    .filter((issue) => issue?.state === undefined || issue.state === 'open')
    .filter((issue) => Number.isInteger(Number(issue?.number)) && Number(issue.number) > 0)
    .sort((left, right) => {
      const leftTime = Date.parse(String(left?.created_at || ''));
      const rightTime = Date.parse(String(right?.created_at || ''));
      const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER;
      const safeRight = Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER;
      return safeLeft - safeRight || Number(left.number) - Number(right.number);
    });
  return candidates[0] || null;
}

export function parseAgentIssueConfiguration(body) {
  const source = String(body ?? '');
  const match = source.match(/<!--\s*hourly-agent\s*\n([\s\S]*?)\n\s*-->/i);
  if (!match) throw new Error('hourly agent configuration is missing');

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new Error('hourly agent configuration is invalid');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('hourly agent configuration is invalid');
  }
  if (!Array.isArray(parsed.allowedFiles) || parsed.allowedFiles.length < 1 || parsed.allowedFiles.length > MAX_FILES) {
    throw new Error(`hourly agent configuration must list 1-${MAX_FILES} allowed files`);
  }

  return {
    ...parsed,
    allowedFiles: uniquePaths(parsed.allowedFiles, 'allowedFiles')
  };
}

export function ensureOnlyAllowedChanges(changedFiles, allowedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    throw new Error('no files changed');
  }
  const changed = uniquePaths(changedFiles, 'changed files');
  const allowed = new Set(uniquePaths(Array.isArray(allowedFiles) ? allowedFiles : [], 'allowed files'));
  for (const path of changed) {
    if (!allowed.has(path)) throw new Error(`changed file is outside the issue allowlist: ${path}`);
  }
  return changed;
}

export function markIssueInProgressTitle(title) {
  const current = text(title);
  if (!current.startsWith(READY_PREFIX)) throw new Error('issue is not agent-ready');
  return `${IN_PROGRESS_PREFIX}${current.slice(READY_PREFIX.length)}`;
}

export function sanitizeVerificationOutput(value) {
  let output = String(value ?? '');
  output = output
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/gh[opsu]_[A-Za-z0-9]{20,}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_API_KEY]')
    .replace(/(?:authorization|bearer)\s*[:=]?\s*Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'authorization: [REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{16,}/gi, 'Bearer [REDACTED]')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED_PRIVATE_KEY]');
  if (output.length > MAX_OUTPUT) {
    output = `${output.slice(0, MAX_OUTPUT - 30)}\n...[output truncated]`;
  }
  return output;
}

export { validateSafePath };
