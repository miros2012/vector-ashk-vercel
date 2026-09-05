import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeHourlyAgentClaims,
  validateHourlyAgentRequest,
  validateHourlyAgentProposal,
  chooseGatewayModel,
  createHourlyProjectAgentService
} from '../lib/hourly-project-agent.js';

const immutableSubject = 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main';
const claims = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'vector-hourly-agent-v1',
  sub: immutableSubject,
  repository: 'miros2012/vector-ashk-vercel',
  repository_id: '1350493825',
  repository_owner_id: '46207692',
  ref: 'refs/heads/main',
  workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/hourly-project-continuation.yml@refs/heads/main',
  event_name: 'schedule',
  actor_id: '46207692',
  run_id: '123',
  run_attempt: '1'
};

function requestBody(mode = 'hourly_agent_patch') {
  return {
    mode,
    requestId: mode === 'hourly_agent_probe'
      ? 'gha-123-attempt-1-probe'
      : 'gha-123-attempt-1-78-1',
    task: {
      issueNumber: 78,
      title: '[agent-ready] Add a pure range capacity guard',
      body: 'Implement a pure helper and tests.',
      attempt: 1,
      testFailure: '',
      files: [
        { path: 'lib/range-capacity.js', content: '', exists: false },
        { path: 'test/range-capacity.test.js', content: '', exists: false }
      ]
    }
  };
}

function gatewayFetch(proposal) {
  return async url => {
    if (String(url).endsWith('/models')) {
      return { ok: true, json: async () => ({ data: [{ id: 'openai/gpt-5.4' }] }) };
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(proposal) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      })
    };
  };
}

const silentLogger = { warn() {}, error() {} };

test('scheduled main workflow claims are authorized with immutable subject IDs', () => {
  assert.equal(authorizeHourlyAgentClaims(claims).eventName, 'schedule');
  assert.throws(() => authorizeHourlyAgentClaims({
    ...claims,
    sub: 'repo:miros2012/vector-ashk-vercel:ref:refs/heads/main'
  }), /forbidden/i);
});

test('issues and manual triggers are restricted to the repository owner', () => {
  assert.throws(() => authorizeHourlyAgentClaims({ ...claims, event_name: 'issues', actor_id: '999' }), /forbidden/i);
  assert.throws(() => authorizeHourlyAgentClaims({ ...claims, event_name: 'workflow_dispatch', actor_id: '999' }), /forbidden/i);
  assert.equal(authorizeHourlyAgentClaims({ ...claims, event_name: 'issues' }).eventName, 'issues');
  assert.equal(authorizeHourlyAgentClaims({ ...claims, event_name: 'workflow_dispatch' }).eventName, 'workflow_dispatch');
});

test('wrong repository, workflow or ref is rejected', () => {
  assert.throws(() => authorizeHourlyAgentClaims({ ...claims, repository: 'evil/repo' }), /forbidden/i);
  assert.throws(() => authorizeHourlyAgentClaims({ ...claims, ref: 'refs/heads/feature' }), /forbidden/i);
  assert.throws(() => authorizeHourlyAgentClaims({ ...claims, workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/other.yml@refs/heads/main' }), /forbidden/i);
});

test('request accepts a bounded owner-authored task and explicit safe files', () => {
  const task = validateHourlyAgentRequest(requestBody());
  assert.equal(task.files.length, 2);
  assert.deepEqual(task.allowedPaths, ['lib/range-capacity.js', 'test/range-capacity.test.js']);
});

test('request rejects workflow, API, config and duplicate paths', () => {
  for (const path of ['.github/workflows/x.yml', 'api/health.js', 'package.json', 'vercel.json', '../secret']) {
    assert.throws(() => validateHourlyAgentRequest({
      mode: 'hourly_agent_patch',
      requestId: 'gha-123-attempt-1-2-1',
      task: { issueNumber: 2, title: '[agent-ready] x', body: 'x', attempt: 1, files: [{ path, content: '', exists: false }] }
    }), /path/i);
  }
  assert.throws(() => validateHourlyAgentRequest({
    mode: 'hourly_agent_patch', requestId: 'gha-123-attempt-1-2-1',
    task: { issueNumber: 2, title: '[agent-ready] x', body: 'x', attempt: 1, files: [
      { path: 'lib/a.js', content: 'a', exists: true }, { path: 'lib/a.js', content: 'a', exists: true }
    ] }
  }), /duplicate/i);
});

test('proposal is limited to listed paths and requires review instead of empty silent success', () => {
  const request = validateHourlyAgentRequest({
    mode: 'hourly_agent_patch', requestId: 'gha-123-attempt-1-2-1',
    task: { issueNumber: 2, title: '[agent-ready] x', body: 'x', attempt: 1, files: [{ path: 'lib/a.js', content: 'old', exists: true }] }
  });
  const valid = validateHourlyAgentProposal({
    summary: 'Small fix',
    changes: [{ path: 'lib/a.js', content: 'new', reason: 'Required' }],
    testPlan: ['npm test'], confidence: 'high', needsHumanReview: false, reviewReason: ''
  }, request);
  assert.equal(valid.changes[0].content, 'new');
  assert.throws(() => validateHourlyAgentProposal({ ...valid, changes: [{ path: 'test/other.js', content: 'x', reason: 'x' }] }, request), /allowed/i);
  assert.throws(() => validateHourlyAgentProposal({ ...valid, changes: [], needsHumanReview: false }, request), /changes/i);
  assert.equal(validateHourlyAgentProposal({ ...valid, changes: [], needsHumanReview: true, reviewReason: 'Ambiguous' }, request).needsHumanReview, true);
});

test('gateway model selection uses a live catalog and fails closed', () => {
  assert.equal(chooseGatewayModel([{ id: 'google/gemini-3.6-flash' }, { id: 'openai/gpt-5.4' }]), 'openai/gpt-5.4');
  assert.throws(() => chooseGatewayModel([{ id: 'unknown/model' }]), /supported/i);
});

test('authenticated service returns a bounded structured proposal and aggregate usage only', async () => {
  const proposal = {
    summary: 'Add helper and regression tests',
    changes: [
      { path: 'lib/range-capacity.js', content: 'export const ok = true;\n', reason: 'Add helper' },
      { path: 'test/range-capacity.test.js', content: "import test from 'node:test';\n", reason: 'Add test' }
    ],
    testPlan: ['npm test'], confidence: 'high', needsHumanReview: false, reviewReason: ''
  };
  const service = createHourlyProjectAgentService({
    verifyToken: async () => claims,
    getGatewayToken: async () => 'gateway-token',
    fetchImpl: gatewayFetch(proposal),
    logger: silentLogger
  });
  const result = await service({ authorization: 'Bearer github-oidc', body: requestBody() });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.model, 'openai/gpt-5.4');
  assert.equal(result.body.proposal.changes.length, 2);
  assert.deepEqual(result.body.usage, { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  assert.equal(JSON.stringify(result.body).includes('gateway-token'), false);
  assert.equal(JSON.stringify(result.body).includes('github-oidc'), false);
});

test('service rejects a request id not bound to the signed workflow run before touching AI Gateway', async () => {
  let gatewayCalled = false;
  const service = createHourlyProjectAgentService({
    verifyToken: async () => claims,
    getGatewayToken: async () => { gatewayCalled = true; return 'gateway-token'; },
    fetchImpl: async () => { gatewayCalled = true; throw new Error('unexpected'); },
    logger: silentLogger
  });
  const body = requestBody();
  body.requestId = 'gha-999-attempt-9-78-1';
  const result = await service({ authorization: 'Bearer signed', body });
  assert.deepEqual(result, { status: 403, body: { ok: false, error: 'forbidden' } });
  assert.equal(gatewayCalled, false);
});

test('service rejects unauthorized callers before touching AI Gateway', async () => {
  let gatewayCalled = false;
  const service = createHourlyProjectAgentService({
    verifyToken: async () => { throw new Error('bad token'); },
    getGatewayToken: async () => { gatewayCalled = true; return 'x'; },
    fetchImpl: async () => { gatewayCalled = true; throw new Error('unexpected'); },
    logger: silentLogger
  });
  const result = await service({ authorization: 'Bearer bad', body: requestBody() });
  assert.deepEqual(result, { status: 403, body: { ok: false, error: 'forbidden' } });
  assert.equal(gatewayCalled, false);
});

test('service exposes only a generic upstream failure', async () => {
  const service = createHourlyProjectAgentService({
    verifyToken: async () => claims,
    getGatewayToken: async () => 'gateway-token',
    fetchImpl: async url => String(url).endsWith('/models')
      ? { ok: true, json: async () => ({ data: [{ id: 'openai/gpt-5.4' }] }) }
      : { ok: false, status: 402, text: async () => 'billing details that must not leak' },
    logger: silentLogger
  });
  const result = await service({ authorization: 'Bearer good', body: requestBody() });
  assert.deepEqual(result, { status: 502, body: { ok: false, error: 'hourly agent generation failed' } });
});

test('probe calls the same authenticated gateway path without repository writes', async () => {
  const service = createHourlyProjectAgentService({
    verifyToken: async () => claims,
    getGatewayToken: async () => 'gateway-token',
    fetchImpl: gatewayFetch({ marker: 'VERCEL_AGENT_OK' }),
    logger: silentLogger
  });
  const result = await service({
    authorization: 'Bearer good',
    body: requestBody('hourly_agent_probe')
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.marker, 'VERCEL_AGENT_OK');
  assert.equal(result.body.model, 'openai/gpt-5.4');
});
