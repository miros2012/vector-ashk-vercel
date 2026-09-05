import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAgentIssueConfiguration,
  selectReadyIssue,
  ensureOnlyAllowedChanges,
  markIssueInProgressTitle,
  sanitizeVerificationOutput
} from '../lib/hourly-agent-runner-policy.js';

test('selects the oldest owner-authored ready issue and ignores pull requests', () => {
  const issue = selectReadyIssue([
    { number: 9, title: '[agent-ready] Later', user: { id: 46207692 }, created_at: '2026-09-05T10:00:00Z' },
    { number: 7, title: '[agent-ready] Oldest', user: { id: 46207692 }, created_at: '2026-09-05T08:00:00Z' },
    { number: 6, title: '[agent-ready] PR', user: { id: 46207692 }, pull_request: {}, created_at: '2026-09-05T07:00:00Z' },
    { number: 5, title: '[agent-ready] Stranger', user: { id: 999 }, created_at: '2026-09-05T06:00:00Z' }
  ]);
  assert.equal(issue.number, 7);
});

test('parses a strict JSON configuration block with explicit allowed files', () => {
  const config = parseAgentIssueConfiguration(`Context\n<!-- hourly-agent\n{"allowedFiles":["lib/a.js","test/a.test.js"]}\n-->\nMore`);
  assert.deepEqual(config.allowedFiles, ['lib/a.js', 'test/a.test.js']);
});

test('rejects missing, malformed or unsafe issue configuration', () => {
  assert.throws(() => parseAgentIssueConfiguration('none'), /configuration/i);
  assert.throws(() => parseAgentIssueConfiguration('<!-- hourly-agent\nnot json\n-->'), /configuration/i);
  for (const unsafePath of [
    'api/health.js',
    'lib/../api/health.js',
    'lib/a b.js',
    'lib/a\n.js',
    'docs/.git/config',
    'docs/secrets/token.txt'
  ]) {
    const body = `<!-- hourly-agent\n${JSON.stringify({ allowedFiles: [unsafePath] })}\n-->`;
    assert.throws(() => parseAgentIssueConfiguration(body), /path/i);
  }
});

test('changed files must be a non-empty subset of the issue allowlist', () => {
  assert.deepEqual(ensureOnlyAllowedChanges(['lib/a.js'], ['lib/a.js', 'test/a.test.js']), ['lib/a.js']);
  assert.throws(() => ensureOnlyAllowedChanges([], ['lib/a.js']), /no files/i);
  assert.throws(() => ensureOnlyAllowedChanges(['lib/b.js'], ['lib/a.js']), /outside/i);
  assert.throws(() => ensureOnlyAllowedChanges(['lib/a.js', 'lib/a.js'], ['lib/a.js']), /duplicate/i);
});

test('issue title transitions are deterministic', () => {
  assert.equal(markIssueInProgressTitle('[agent-ready] Fix capacity'), '[agent-in-progress] Fix capacity');
});

test('verification output is bounded and redacts common credentials', () => {
  const result = sanitizeVerificationOutput(`failed ghp_${'a'.repeat(40)} sk-${'b'.repeat(30)}\n${'x'.repeat(20_000)}`);
  assert.equal(result.includes('ghp_'), false);
  assert.equal(result.includes('sk-'), false);
  assert.ok(result.length <= 12_000);
});
