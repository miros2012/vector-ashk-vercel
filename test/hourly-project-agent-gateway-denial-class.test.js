import test from 'node:test';
import assert from 'node:assert/strict';
import { createHourlyProjectAgentService } from '../lib/hourly-project-agent.js';

const claims = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'vector-hourly-agent-v1',
  sub: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main',
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

const body = {
  mode: 'hourly_agent_patch',
  requestId: 'gha-123-attempt-1-79-1',
  task: {
    issueNumber: 79,
    title: '[agent-ready] Prove guarded hourly continuation end to end',
    body: 'Create a harmless smoke document.',
    attempt: 1,
    testFailure: '',
    files: [{ path: 'docs/hourly-agent-smoke.md', content: '', exists: false }]
  }
};

async function runWithGatewayError(payload) {
  const errors = [];
  const service = createHourlyProjectAgentService({
    verifyToken: async () => claims,
    getGatewayToken: async () => 'gateway-token',
    fetchImpl: async url => String(url).endsWith('/models')
      ? { ok: true, json: async () => ({ data: [{ id: 'openai/gpt-5.4' }] }) }
      : { ok: false, status: 403, json: async () => payload },
    logger: {
      warn() {},
      error(...args) { errors.push(args); }
    }
  });
  const result = await service({ authorization: 'Bearer github-oidc', body });
  return { result, errors };
}

test('nested standard error code is retained as a sanitized diagnostic class', async () => {
  const { result, errors } = await runWithGatewayError({
    error: {
      message: 'Sensitive authentication detail that must never be logged',
      type: 'permission_error',
      code: 'invalid_authentication'
    }
  });

  assert.deepEqual(result, {
    status: 502,
    body: { ok: false, error: 'hourly agent generation failed' }
  });
  assert.deepEqual(errors, [[
    'hourly-agent-generation:',
    'gateway_completion_http_403_invalid_authentication'
  ]]);
  assert.doesNotMatch(JSON.stringify(errors), /Sensitive authentication detail/i);
});

test('known model restriction message is classified without logging the message', async () => {
  const { errors } = await runWithGatewayError({
    error: 'Your team has restricted access to this model. Contact the owner for details.',
    statusCode: 403
  });

  assert.deepEqual(errors, [[
    'hourly-agent-generation:',
    'gateway_completion_http_403_model_restricted'
  ]]);
  assert.doesNotMatch(JSON.stringify(errors), /restricted access to this model/i);
});

test('unknown free-form messages remain unclassified', async () => {
  const { errors } = await runWithGatewayError({
    error: 'Arbitrary private message with account-specific details'
  });

  assert.deepEqual(errors, [[
    'hourly-agent-generation:',
    'gateway_completion_http_403'
  ]]);
});
