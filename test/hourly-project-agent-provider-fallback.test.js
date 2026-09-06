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

function successPayload() {
  return {
    choices: [{
      message: {
        content: JSON.stringify({
          summary: 'Create the harmless smoke artifact.',
          changes: [{
            path: 'docs/hourly-agent-smoke.md',
            content: '# Hourly agent smoke\n\nVECTOR_HOURLY_AGENT_SMOKE_OK\n',
            reason: 'Prove the guarded PR-only loop.'
          }],
          testPlan: ['Run the full test suite.'],
          confidence: 'high',
          needsHumanReview: false,
          reviewReason: ''
        })
      }
    }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
  };
}

test('customer verification denial falls back once to a different provider', async () => {
  const completionModels = [];
  const service = createHourlyProjectAgentService({
    verifyToken: async () => claims,
    getGatewayToken: async () => 'gateway-token',
    fetchImpl: async (url, options = {}) => {
      if (String(url).endsWith('/models')) {
        return {
          ok: true,
          json: async () => ({ data: [
            { id: 'openai/gpt-5.6-sol' },
            { id: 'anthropic/claude-sonnet-4.6' },
            { id: 'google/gemini-3.1-pro-preview' }
          ] })
        };
      }
      const model = JSON.parse(options.body).model;
      completionModels.push(model);
      if (model === 'openai/gpt-5.6-sol') {
        return {
          ok: false,
          status: 403,
          json: async () => ({ type: 'customer_verification_required' })
        };
      }
      return { ok: true, json: async () => successPayload() };
    },
    logger: { warn() {}, error() {} }
  });

  const result = await service({ authorization: 'Bearer github-oidc', body });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.model, 'anthropic/claude-sonnet-4.6');
  assert.deepEqual(completionModels, [
    'openai/gpt-5.6-sol',
    'anthropic/claude-sonnet-4.6'
  ]);
});

test('authentication denial never retries another model', async () => {
  const completionModels = [];
  const errors = [];
  const service = createHourlyProjectAgentService({
    verifyToken: async () => claims,
    getGatewayToken: async () => 'gateway-token',
    fetchImpl: async (url, options = {}) => {
      if (String(url).endsWith('/models')) {
        return {
          ok: true,
          json: async () => ({ data: [
            { id: 'openai/gpt-5.6-sol' },
            { id: 'anthropic/claude-sonnet-4.6' }
          ] })
        };
      }
      completionModels.push(JSON.parse(options.body).model);
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: { code: 'invalid_authentication' } })
      };
    },
    logger: {
      warn() {},
      error(...args) { errors.push(args); }
    }
  });

  const result = await service({ authorization: 'Bearer github-oidc', body });

  assert.equal(result.status, 502);
  assert.deepEqual(completionModels, ['openai/gpt-5.6-sol']);
  assert.deepEqual(errors, [[
    'hourly-agent-generation:',
    'gateway_completion_http_403_invalid_authentication'
  ]]);
});

test('provider fallback is bounded by the explicit supported model list', async () => {
  const completionModels = [];
  const errors = [];
  const service = createHourlyProjectAgentService({
    verifyToken: async () => claims,
    getGatewayToken: async () => 'gateway-token',
    fetchImpl: async (url, options = {}) => {
      if (String(url).endsWith('/models')) {
        return {
          ok: true,
          json: async () => ({ data: [
            { id: 'openai/gpt-5.6-sol' },
            { id: 'anthropic/claude-sonnet-4.6' },
            { id: 'google/gemini-3.1-pro-preview' },
            { id: 'unknown/unbounded-model' }
          ] })
        };
      }
      completionModels.push(JSON.parse(options.body).model);
      return {
        ok: false,
        status: 403,
        json: async () => ({ type: 'customer_verification_required' })
      };
    },
    logger: {
      warn() {},
      error(...args) { errors.push(args); }
    }
  });

  const result = await service({ authorization: 'Bearer github-oidc', body });

  assert.equal(result.status, 502);
  assert.deepEqual(completionModels, [
    'openai/gpt-5.6-sol',
    'anthropic/claude-sonnet-4.6',
    'google/gemini-3.1-pro-preview'
  ]);
  assert.deepEqual(errors, [[
    'hourly-agent-generation:',
    'gateway_completion_http_403_customer_verification_required'
  ]]);
});
