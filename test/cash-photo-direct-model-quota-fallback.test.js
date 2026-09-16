import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CASH_PHOTO_MODELS,
  recognizeWithFallback
} from '../lib/cash-photo-recognizer.js';
import { recognizeCashPhotoViaGateway } from '../lib/cash-photo-gateway-fallback.js';

const key = 'test-only-gemini-key';
const payload = { contents: [{ role: 'user', parts: [{ text: 'Read a journal' }] }] };
const data = { initialBalance: 0, visibleMoneyRowCount: 0, finalBalance: 0, finalBalanceReadable: true, pageNote: '', operations: [] };

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function geminiSuccess() {
  return response(200, {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(data) }] } }]
  });
}

function gatewayPayload() {
  return {
    contents: [{
      role: 'user',
      parts: [
        { text: 'Распознай кассовый журнал.' },
        { inlineData: { mimeType: 'image/jpeg', data: Buffer.from('photo').toString('base64') } }
      ]
    }],
    generationConfig: {
      responseJsonSchema: {
        type: 'object',
        properties: { operations: { type: 'array', items: { type: 'object' } } },
        required: ['operations']
      }
    }
  };
}

test('default cash-photo Gemini models prioritize independent model quotas suited to document parsing', () => {
  assert.deepEqual(DEFAULT_CASH_PHOTO_MODELS, [
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash'
  ]);
});

test('direct Gemini falls from Flash-Lite rate limit to 3.6 Flash before any Gateway call', async () => {
  const calls = [];
  let gatewayCalls = 0;
  const result = await recognizeWithFallback({
    apiKey: key,
    payload,
    maxAttemptsPerModel: 1,
    baseDelayMs: 0,
    fetchImpl: async url => {
      calls.push(String(url));
      return String(url).includes('gemini-3.5-flash-lite') ? response(429, {}) : geminiSuccess();
    },
    gatewayEnabled: true,
    getGatewayToken: async () => { gatewayCalls += 1; return 'unused'; },
    gatewayFetchImpl: async () => { gatewayCalls += 1; return response(500, {}); }
  });

  assert.equal(result.model, 'gemini-3.6-flash');
  assert.deepEqual(calls.map(url => url.match(/models\/(.+?):generateContent/)?.[1]), [
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash'
  ]);
  assert.equal(gatewayCalls, 0);
});

test('Gateway stops provider fanout immediately when team-wide customer verification blocks inference', async () => {
  const completionModels = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/v1/models')) {
      return response(200, {
        data: [
          { id: 'openai/gpt-5.6-luna', modalities: { input: ['text', 'image'], output: ['text'] } },
          { id: 'anthropic/claude-sonnet-5', modalities: { input: ['text', 'image'], output: ['text'] } }
        ]
      });
    }
    completionModels.push(JSON.parse(options.body).model);
    return response(403, { error: { type: 'customer_verification_required', message: 'private billing detail' } });
  };

  await assert.rejects(
    recognizeCashPhotoViaGateway({ gatewayToken: 'oidc-token', payload: gatewayPayload(), fetchImpl }),
    error => {
      assert.equal(error.retryable, true);
      assert.deepEqual(error.diagnostics, [
        'openai/gpt-5.6-luna: HTTP 403 customer_verification_required'
      ]);
      return true;
    }
  );
  assert.deepEqual(completionModels, ['openai/gpt-5.6-luna']);
});
