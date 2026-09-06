const EXPECTED_REPOSITORY = 'miros2012/vector-ashk-vercel';
const DEFAULT_OWNER_ID = 46207692;
const AUTO_MERGE_MARKER = '<!-- hourly-agent-automerge: additive-only -->';
const MAX_FILES = 6;
const SAFE_ROOTS = ['lib/', 'test/', 'docs/'];
const SAFE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const BLOCKED_EXACT_PATHS = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'vercel.json',
  '.env',
  '.env.local'
]);

function text(value) {
  return String(value ?? '').trim();
}

function failure(reason) {
  return { ok: false, reason };
}

function isSha(value) {
  return /^[a-f\d]{40}$/i.test(text(value));
}

function parseAgentConfiguration(body) {
  const match = String(body ?? '').match(/<!--\s*hourly-agent\s*\n([\s\S]*?)\n\s*-->/i);
  if (!match) throw new Error('agent configuration missing');
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new Error('agent configuration invalid');
  }
  if (!Array.isArray(parsed?.allowedFiles) || parsed.allowedFiles.length < 1 || parsed.allowedFiles.length > MAX_FILES) {
    throw new Error('agent allowed files invalid');
  }
  return parsed.allowedFiles.map(value => text(value).replace(/\\/g, '/'));
}

function isSafePath(value) {
  const filePath = text(value).replace(/\\/g, '/');
  if (!filePath || !SAFE_PATH_PATTERN.test(filePath) || filePath.startsWith('/') || filePath.includes('\0')) return false;
  const segments = filePath.split('/');
  if (segments.includes('.') || segments.includes('..') || segments.some(segment => segment.toLowerCase() === '.git')) return false;
  if (!SAFE_ROOTS.some(root => filePath.startsWith(root))) return false;
  if (filePath.startsWith('.github/') || filePath.startsWith('api/') || filePath.startsWith('scripts/')) return false;
  if (BLOCKED_EXACT_PATHS.has(filePath)) return false;
  if (/(^|\/)(?:\.env|secrets?|credentials?)(?:\.|\/|$)/i.test(filePath)) return false;
  return true;
}

function exactSamePaths(left, right) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function linkedIssueNumber(pullBody) {
  const match = String(pullBody ?? '').match(/\bCloses\s+#(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

export function evaluateHourlyAgentAutoMerge({
  repository,
  ownerId = DEFAULT_OWNER_ID,
  issue,
  pull,
  files = [],
  statuses = {},
  sourceRun,
  currentMainSha
} = {}) {
  if (text(repository) !== EXPECTED_REPOSITORY) return failure('unexpected-repository');
  if (!issue || issue.state !== 'open') return failure('issue-not-open');
  if (Number(issue?.user?.id) !== Number(ownerId)) return failure('issue-owner-mismatch');
  if (!String(issue?.body ?? '').includes(AUTO_MERGE_MARKER)) return failure('automerge-not-authorized');

  let allowedFiles;
  try {
    allowedFiles = parseAgentConfiguration(issue.body);
  } catch {
    return failure('invalid-agent-configuration');
  }
  if (new Set(allowedFiles).size !== allowedFiles.length) return failure('duplicate-allowed-file');
  if (allowedFiles.some(filePath => !isSafePath(filePath))) return failure('unsafe-allowed-file');

  if (!pull || pull.state !== 'open' || pull.draft) return failure('pull-not-ready');
  if (text(pull?.head?.repo?.full_name) !== EXPECTED_REPOSITORY) return failure('pull-repository-mismatch');
  if (!text(pull?.head?.ref).startsWith('agent/')) return failure('pull-branch-not-agent');
  if (text(pull?.base?.ref) !== 'main') return failure('pull-base-not-main');
  if (linkedIssueNumber(pull.body) !== Number(issue.number)
      || !String(pull.body ?? '').includes('Automated bounded proposal created by the guarded hourly continuation runner.')) {
    return failure('pull-issue-link-invalid');
  }

  const headSha = text(pull?.head?.sha);
  const baseSha = text(pull?.base?.sha);
  if (!isSha(headSha) || !isSha(baseSha) || !isSha(currentMainSha)) return failure('invalid-commit-sha');
  if (text(currentMainSha) !== baseSha) return failure('base-main-moved');
  if (pull.mergeable !== true || !['clean', 'has_hooks'].includes(text(pull.mergeable_state))) {
    return failure('pull-not-mergeable');
  }

  if (!sourceRun || sourceRun.name !== 'Node test suite'
      || sourceRun.event !== 'pull_request'
      || sourceRun.status !== 'completed'
      || sourceRun.conclusion !== 'success') {
    return failure('source-ci-not-green');
  }
  if (text(sourceRun.head_sha) !== headSha) return failure('source-ci-head-mismatch');
  if (text(statuses?.['hourly-agent/isolated-verification']).toLowerCase() !== 'success') {
    return failure('isolated-verification-not-green');
  }

  const changedFiles = Array.isArray(files) ? files.map(file => ({
    filename: text(file?.filename).replace(/\\/g, '/'),
    status: text(file?.status)
  })) : [];
  if (changedFiles.some(file => !isSafePath(file.filename))) return failure('unsafe-allowed-file');
  if (changedFiles.some(file => file.status !== 'added')) return failure('non-additive-change');
  if (!exactSamePaths(changedFiles.map(file => file.filename), allowedFiles)) return failure('changed-files-mismatch');

  return {
    ok: true,
    issueNumber: Number(issue.number),
    pullNumber: Number(pull.number),
    headSha,
    allowedFiles: [...allowedFiles]
  };
}
