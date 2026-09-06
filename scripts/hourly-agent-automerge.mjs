import { evaluateHourlyAgentAutoMerge } from '../lib/hourly-agent-automerge-policy.js';

const API = 'https://api.github.com';
const EXPECTED_REPOSITORY = 'miros2012/vector-ashk-vercel';
const TOKEN = String(process.env.GITHUB_TOKEN || '').trim();
const REPOSITORY = String(process.env.GITHUB_REPOSITORY || '').trim();
const SOURCE_RUN_ID = String(process.env.SOURCE_RUN_ID || '').trim();
const SOURCE_HEAD_SHA = String(process.env.SOURCE_HEAD_SHA || '').trim();
const OWNER_ID = 46207692;

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function sanitize(value) {
  return String(value ?? '')
    .replace(/gh[opsu]_[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 2000);
}

async function github(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${API}/repos/${REPOSITORY}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'x-github-api-version': '2022-11-28',
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`GitHub API returned invalid JSON (${response.status})`);
    }
  }
  if (!response.ok) {
    throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${sanitize(payload?.message || text)}`);
  }
  return payload;
}

function issueNumberFromBody(body) {
  const match = String(body ?? '').match(/\bCloses\s+#(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function statusMap(combined) {
  const map = {};
  for (const status of Array.isArray(combined?.statuses) ? combined.statuses : []) {
    const context = String(status?.context || '').trim();
    if (context && map[context] === undefined) map[context] = String(status?.state || '').trim();
  }
  return map;
}

async function sourceRun() {
  const run = await github(`/actions/runs/${required(SOURCE_RUN_ID, 'SOURCE_RUN_ID')}`);
  if (String(run?.head_sha || '') !== required(SOURCE_HEAD_SHA, 'SOURCE_HEAD_SHA')) {
    throw new Error('source workflow head SHA does not match event payload');
  }
  return run;
}

async function candidatePulls(headSha) {
  const pulls = await github(`/commits/${headSha}/pulls?per_page=100`, {
    headers: { accept: 'application/vnd.github+json' }
  });
  return (Array.isArray(pulls) ? pulls : []).filter(pull =>
    pull?.state === 'open'
    && String(pull?.head?.ref || '').startsWith('agent/')
    && String(pull?.base?.ref || '') === 'main'
  );
}

async function main() {
  required(TOKEN, 'GITHUB_TOKEN');
  required(REPOSITORY, 'GITHUB_REPOSITORY');
  if (REPOSITORY !== EXPECTED_REPOSITORY) throw new Error('unexpected repository');

  const run = await sourceRun();
  if (run.name !== 'Node test suite' || run.event !== 'pull_request' || run.status !== 'completed' || run.conclusion !== 'success') {
    console.log('Hourly agent auto-merge idle: source workflow is not an eligible successful pull-request test run.');
    return;
  }

  const pulls = await candidatePulls(SOURCE_HEAD_SHA);
  if (pulls.length === 0) {
    console.log('Hourly agent auto-merge idle: no eligible agent pull request for this commit.');
    return;
  }
  if (pulls.length !== 1) throw new Error('multiple eligible agent pull requests found for one commit');

  const pull = await github(`/pulls/${pulls[0].number}`);
  const issueNumber = issueNumberFromBody(pull.body);
  if (!Number.isInteger(issueNumber) || issueNumber < 1) {
    console.log('Hourly agent auto-merge skipped: pull request is not linked to one owner task.');
    return;
  }

  const [issue, files, combinedStatus, mainBranch] = await Promise.all([
    github(`/issues/${issueNumber}`),
    github(`/pulls/${pull.number}/files?per_page=100`),
    github(`/commits/${SOURCE_HEAD_SHA}/status`),
    github('/branches/main')
  ]);

  const decision = evaluateHourlyAgentAutoMerge({
    repository: REPOSITORY,
    ownerId: OWNER_ID,
    issue,
    pull,
    files,
    statuses: statusMap(combinedStatus),
    sourceRun: run,
    currentMainSha: mainBranch?.commit?.sha
  });

  if (!decision.ok) {
    console.log(`Hourly agent auto-merge skipped: ${decision.reason}.`);
    return;
  }

  const merge = await github(`/pulls/${pull.number}/merge`, {
    method: 'PUT',
    body: {
      sha: decision.headSha,
      merge_method: 'squash',
      commit_title: `agent: ${String(issue.title || '').replace(/^\[[^\]]+\]\s*/, '').trim()}`,
      commit_message: [
        'Automatically merged under the additive-only hourly agent policy.',
        '',
        `Owner task: #${decision.issueNumber}`,
        `Verified files: ${decision.allowedFiles.join(', ')}`,
        'Both isolated verification and the normal repository test workflow passed.',
        'No existing file was modified.'
      ].join('\n')
    }
  });
  if (merge?.merged !== true) throw new Error(`merge rejected: ${sanitize(merge?.message || 'unknown reason')}`);

  await github(`/issues/${decision.issueNumber}/comments`, {
    method: 'POST',
    body: {
      body: `Additive-only agent PR #${decision.pullNumber} was automatically merged after isolated verification and the normal test workflow both passed.`
    }
  });
  console.log(`Hourly agent auto-merged pull request #${decision.pullNumber}.`);
}

main().catch(error => {
  console.error(sanitize(error?.message || String(error)));
  process.exitCode = 1;
});
