import {
  ensureOnlyAllowedChanges,
  sanitizeVerificationOutput
} from './hourly-agent-runner-policy.js';

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} is invalid`);
  return number;
}

function safeRunId(value) {
  const runId = text(value);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(runId)) throw new Error('run id is invalid');
  return runId;
}

export function buildAgentRunKey(runId, runAttempt = 1) {
  return `${safeRunId(runId)}-attempt-${positiveInteger(runAttempt, 'run attempt')}`;
}

export function buildAgentBranchName(issueNumber, runId) {
  return `agent/issue-${positiveInteger(issueNumber, 'issue number')}-run-${safeRunId(runId)}`;
}

export function buildAgentRequestBody({
  issue,
  files,
  runId,
  attempt = 1,
  testFailure = ''
} = {}) {
  const issueNumber = positiveInteger(issue?.number, 'issue number');
  const normalizedAttempt = positiveInteger(attempt, 'attempt');
  if (normalizedAttempt > 2) throw new Error('attempt is invalid');
  const normalizedFiles = Array.isArray(files)
    ? files.map((file) => ({
        path: text(file?.path),
        content: String(file?.content ?? ''),
        exists: Boolean(file?.exists)
      }))
    : [];

  return {
    mode: 'hourly_agent_patch',
    requestId: `gha-${safeRunId(runId)}-${issueNumber}-${normalizedAttempt}`,
    task: {
      issueNumber,
      title: text(issue?.title),
      body: String(issue?.body ?? '').slice(0, 30_000),
      attempt: normalizedAttempt,
      testFailure: sanitizeVerificationOutput(testFailure).slice(0, 12_000),
      files: normalizedFiles
    }
  };
}

export function hasOpenAgentPull(pulls = []) {
  return (Array.isArray(pulls) ? pulls : []).some((pull) =>
    String(pull?.state || 'open') === 'open'
      && text(pull?.head?.ref).startsWith('agent/')
  );
}

export function verifyProposalChangeSet(changes, allowedFiles) {
  const paths = (Array.isArray(changes) ? changes : []).map((change) => text(change?.path));
  return ensureOnlyAllowedChanges(paths, allowedFiles);
}
