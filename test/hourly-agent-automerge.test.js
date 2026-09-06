import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateHourlyAgentAutoMerge } from '../lib/hourly-agent-automerge-policy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const OWNER_ID = 46207692;
const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

function issue(overrides = {}) {
  return {
    number: 101,
    state: 'open',
    title: '[pr-open] Add safe module',
    user: { id: OWNER_ID },
    body: [
      'Safe additive task.',
      '<!-- hourly-agent-automerge: additive-only -->',
      '<!-- hourly-agent',
      '{"allowedFiles":["lib/safe-module.js","test/safe-module.test.js"]}',
      '-->'
    ].join('\n'),
    ...overrides
  };
}

function pull(overrides = {}) {
  return {
    number: 202,
    state: 'open',
    draft: false,
    mergeable: true,
    mergeable_state: 'clean',
    user: { login: 'github-actions[bot]' },
    head: {
      sha: HEAD_SHA,
      ref: 'agent/101-12345-1',
      repo: { full_name: 'miros2012/vector-ashk-vercel' }
    },
    base: { sha: BASE_SHA, ref: 'main' },
    body: 'Closes #101.\n\nAutomated bounded proposal created by the guarded hourly continuation runner.',
    ...overrides
  };
}

function files(overrides = []) {
  return overrides.length ? overrides : [
    { filename: 'lib/safe-module.js', status: 'added' },
    { filename: 'test/safe-module.test.js', status: 'added' }
  ];
}

function statuses(overrides = {}) {
  return {
    'hourly-agent/isolated-verification': 'success',
    ...overrides
  };
}

function sourceRun(overrides = {}) {
  return {
    name: 'Node test suite',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    head_sha: HEAD_SHA,
    ...overrides
  };
}

function evaluate(overrides = {}) {
  return evaluateHourlyAgentAutoMerge({
    repository: 'miros2012/vector-ashk-vercel',
    ownerId: OWNER_ID,
    issue: issue(),
    pull: pull(),
    files: files(),
    statuses: statuses(),
    sourceRun: sourceRun(),
    currentMainSha: BASE_SHA,
    ...overrides
  });
}

test('allows only an owner-authorized additive agent PR with both green verification layers', () => {
  assert.deepEqual(evaluate(), {
    ok: true,
    issueNumber: 101,
    pullNumber: 202,
    headSha: HEAD_SHA,
    allowedFiles: ['lib/safe-module.js', 'test/safe-module.test.js']
  });
});

test('requires the explicit additive-only automerge marker', () => {
  const result = evaluate({ issue: issue({ body: issue().body.replace('<!-- hourly-agent-automerge: additive-only -->', '') }) });
  assert.deepEqual(result, { ok: false, reason: 'automerge-not-authorized' });
});

test('rejects non-owner issues, foreign repositories, non-agent branches and stale main', () => {
  assert.equal(evaluate({ issue: issue({ user: { id: 7 } }) }).reason, 'issue-owner-mismatch');
  assert.equal(evaluate({ pull: pull({ head: { ...pull().head, repo: { full_name: 'fork/repo' } } }) }).reason, 'pull-repository-mismatch');
  assert.equal(evaluate({ pull: pull({ head: { ...pull().head, ref: 'feature/manual' } }) }).reason, 'pull-branch-not-agent');
  assert.equal(evaluate({ currentMainSha: 'c'.repeat(40) }).reason, 'base-main-moved');
});

test('rejects drafts, conflicts, wrong source runs and missing isolated verification', () => {
  assert.equal(evaluate({ pull: pull({ draft: true }) }).reason, 'pull-not-ready');
  assert.equal(evaluate({ pull: pull({ mergeable: false, mergeable_state: 'dirty' }) }).reason, 'pull-not-mergeable');
  assert.equal(evaluate({ sourceRun: sourceRun({ conclusion: 'failure' }) }).reason, 'source-ci-not-green');
  assert.equal(evaluate({ sourceRun: sourceRun({ head_sha: 'd'.repeat(40) }) }).reason, 'source-ci-head-mismatch');
  assert.equal(evaluate({ statuses: statuses({ 'hourly-agent/isolated-verification': 'pending' }) }).reason, 'isolated-verification-not-green');
});

test('requires an exact allowlist and newly added files only', () => {
  assert.equal(evaluate({ files: files([{ filename: 'lib/safe-module.js', status: 'modified' }, { filename: 'test/safe-module.test.js', status: 'added' }]) }).reason, 'non-additive-change');
  assert.equal(evaluate({ files: files([{ filename: 'lib/safe-module.js', status: 'added' }]) }).reason, 'changed-files-mismatch');
  assert.equal(evaluate({ files: files([{ filename: 'lib/safe-module.js', status: 'added' }, { filename: 'api/unsafe.js', status: 'added' }]) }).reason, 'unsafe-allowed-file');
});

test('rejects traversal, workflow, script, config, secret and duplicate paths', () => {
  for (const unsafe of [
    '../escape.js',
    '.github/workflows/evil.yml',
    'scripts/evil.mjs',
    'api/evil.js',
    'lib/../api/evil.js',
    'lib/credentials.json',
    'lib/.env',
    'package.json'
  ]) {
    const body = issue().body.replace('lib/safe-module.js', unsafe);
    assert.equal(evaluate({ issue: issue({ body }) }).reason, 'unsafe-allowed-file', unsafe);
  }
  const duplicateBody = issue().body.replace('["lib/safe-module.js","test/safe-module.test.js"]', '["lib/safe-module.js","lib/safe-module.js"]');
  assert.equal(evaluate({ issue: issue({ body: duplicateBody }) }).reason, 'duplicate-allowed-file');
});

test('wiring runs only after the normal test workflow and never calls finance endpoints', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/hourly-agent-automerge.yml'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'scripts/hourly-agent-automerge.mjs'), 'utf8');

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Node test suite/);
  assert.match(workflow, /types:\s*\[completed\]/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /pull-requests:\s*write/);
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /node scripts\/hourly-agent-automerge\.mjs/);

  assert.match(script, /evaluateHourlyAgentAutoMerge/);
  assert.match(script, /\/pulls\/\$\{pull\.number\}\/merge/);
  assert.match(script, /hourly-agent\/isolated-verification/);
  assert.doesNotMatch(script, /\/api\/balances|nightly-finance-orchestrator|decision-event|sync-payments|sync-hours/);
});
