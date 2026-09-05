import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgentBranchName,
  buildAgentRequestBody,
  buildAgentRunKey,
  hasOpenAgentPull,
  verifyProposalChangeSet
} from '../lib/hourly-project-agent-runner.js';

const issue = {
  number: 42,
  title: '[agent-ready] Add a pure capacity helper',
  body: 'Implement the bounded helper and regression tests.'
};

const files = [
  { path: 'lib/range-capacity.js', content: '', exists: false },
  { path: 'test/range-capacity.test.js', content: '', exists: false }
];

test('builds a retry-unique run key and deterministic isolated branch', () => {
  assert.equal(buildAgentRunKey('33964889799', '2'), '33964889799-attempt-2');
  assert.equal(
    buildAgentBranchName(42, buildAgentRunKey('33964889799', '2')),
    'agent/issue-42-run-33964889799-attempt-2'
  );
  assert.throws(() => buildAgentRunKey('../main', '1'), /run/i);
  assert.throws(() => buildAgentRunKey('1', '0'), /attempt/i);
  assert.throws(() => buildAgentBranchName(0, '1-attempt-1'), /issue/i);
});

test('builds a bounded request for one issue and one repair attempt', () => {
  const request = buildAgentRequestBody({
    issue,
    files,
    runId: '33964889799-attempt-2',
    attempt: 2,
    testFailure: `failed\n${'x'.repeat(20_000)}`
  });
  assert.equal(request.mode, 'hourly_agent_patch');
  assert.equal(request.task.issueNumber, 42);
  assert.equal(request.task.attempt, 2);
  assert.equal(request.task.files.length, 2);
  assert.ok(request.task.testFailure.length <= 12_000);
  assert.match(request.requestId, /^gha-33964889799-attempt-2-42-2$/);
});

test('recognizes any existing agent pull request as a serialization gate', () => {
  assert.equal(hasOpenAgentPull([
    { state: 'open', head: { ref: 'feature/manual' } },
    { state: 'open', head: { ref: 'agent/issue-7-run-123' } }
  ]), true);
  assert.equal(hasOpenAgentPull([{ state: 'closed', head: { ref: 'agent/old' } }]), false);
});

test('proposal changes remain a non-empty exact subset of the owner allowlist', () => {
  assert.deepEqual(
    verifyProposalChangeSet([{ path: 'lib/range-capacity.js', content: 'export const ok = true;\n' }], files.map(file => file.path)),
    ['lib/range-capacity.js']
  );
  assert.throws(() => verifyProposalChangeSet([], files.map(file => file.path)), /no files/i);
  assert.throws(() => verifyProposalChangeSet([{ path: 'api/health.js', content: 'x' }], files.map(file => file.path)), /outside|path/i);
});
