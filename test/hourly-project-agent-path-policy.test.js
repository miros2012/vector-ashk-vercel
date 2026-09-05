import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHourlyAgentRequest } from '../lib/hourly-project-agent.js';

function request(path) {
  return {
    mode: 'hourly_agent_patch',
    requestId: 'gha-1-2-1',
    task: {
      issueNumber: 2,
      title: '[agent-ready] bounded task',
      body: 'test',
      attempt: 1,
      files: [{ path, content: '', exists: false }]
    }
  };
}

test('service rejects path syntax rejected by the runner policy', () => {
  for (const unsafePath of [
    'lib/a b.js',
    'lib/a\n.js',
    'docs/.git/config',
    'docs/credentials/token.txt',
    'lib/../api/health.js'
  ]) {
    assert.throws(() => validateHourlyAgentRequest(request(unsafePath)), /path/i);
  }
});
