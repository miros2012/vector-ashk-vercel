import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseCashPhotoGatewayModels,
  recognizeCashPhotoViaGateway,
  recognizeCashPhotoWithGatewayFallback
} from '../lib/cash-photo-gateway-fallback.js';

function geminiPayload() {
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
        additionalProperties: false,
        properties: {
          initialBalance: { type: 'number' },
          visibleMoneyRowCount: { type: 'integer' },
          finalBalance: { type: 'number' },
          finalBalanceReadable: { type: 'boolean' },
          pageNote: { type: 'string' },
          operations: { type: 'array', items: { type: 'object' } }
        },
        required: ['initialBalance', 'visibleMoneyRowCount', 'finalBalance', 'finalBalanceReadable', 'pageNote', 'operations']
      }
    }
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

test('gateway fallback prefers independent current vision models and excludes Google', () => {
  const models = chooseCashPhotoGatewayModels([
    { id: 'google/gemini-3.1-pro-preview', modalities: { input: ['text', 'image'], output: ['text'] } },
    { id: 'anthropic/claude-sonnet-5', modalities: { input: ['text', 'image', 'pdf'], output: ['text'] } },
    { id: 'openai/gpt-5.6-luna', modalities: { input: ['text', 'image', 'pdf'], output: ['text'] } },
    { id: 'openai/gpt-5.6-sol', modalities: { input: ['text'], output: ['text'] } }
  ]);

  assert.deepEqual(models, ['openai/gpt-5.6-luna', 'anthropic/claude-sonnet-5']);
  assert.ok(models.every(model => !model.startsWith('google/')));
});

test('gateway recognition sends the same prompt, image and JSON schema and parses structured output', async () => {
  const calls = [];
  const expected = {
    initialBalance: 1000,
    visibleMoneyRowCount: 1,
    finalBalance: 1200,
    finalBalanceReadable: true,
    pageNote: '',
    operations: []
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (String(url).endsWith('/v1/models')) {
      return jsonResponse(200, {
        data: [
          { id: 'openai/gpt-5.6-luna', modalities: { input: ['text', 'image'], output: ['text'] } }
        ]
      });
    }
    return jsonResponse(200, {
      choices: [{ message: { content: JSON.stringify(expected) } }]
    });
  };

  const result = await recognizeCashPhotoViaGateway({
    gatewayToken: 'oidc-token',
    payload: geminiPayload(),
    fetchImpl
  });

  assert.equal(result.model, 'openai/gpt-5.6-luna');
  assert.deepEqual(result.data, expected);
  assert.equal(calls.length, 2);
  const request = JSON.parse(calls[1].options.body);
  assert.equal(request.model, 'openai/gpt-5.6-luna');
  assert.equal(request.messages[0].content[0].text, 'Распознай кассовый журнал.');
  assert.match(request.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(request.response_format.type, 'json_schema');
  assert.deepEqual(request.response_format.json_schema.schema, geminiPayload().generationConfig.responseJsonSchema);
  assert.equal(calls[1].options.headers.authorization, 'Bearer oidc-token');
});

test('gateway recognition falls through from a rate-limited model to a second independent provider', async () => {
  const attempted = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/v1/models')) {
      return jsonResponse(200, {
        data: [
          { id: 'openai/gpt-5.6-luna', modalities: { input: ['text', 'image'], output: ['text'] } },
          { id: 'anthropic/claude-sonnet-5', modalities: { input: ['text', 'image'], output: ['text'] } }
        ]
      });
    }
    const request = JSON.parse(options.body);
    attempted.push(request.model);
    if (request.model === 'openai/gpt-5.6-luna') return jsonResponse(429, { error: { type: 'rate_limit_error' } });
    return jsonResponse(200, {
      choices: [{ message: { content: JSON.stringify({
        initialBalance: -1,
        visibleMoneyRowCount: 0,
        finalBalance: -1,
        finalBalanceReadable: false,
        pageNote: '',
        operations: []
      }) } }]
    });
  };

  const result = await recognizeCashPhotoViaGateway({ gatewayToken: 'oidc-token', payload: geminiPayload(), fetchImpl });

  assert.deepEqual(attempted, ['openai/gpt-5.6-luna', 'anthropic/claude-sonnet-5']);
  assert.equal(result.model, 'anthropic/claude-sonnet-5');
});

test('provider fallback uses AI Gateway only for retryable direct Gemini failures', async () => {
  let gatewayCalls = 0;
  const retryable = Object.assign(new Error('temporary'), { retryable: true, diagnostics: ['gemini: HTTP 429'] });
  const result = await recognizeCashPhotoWithGatewayFallback({
    primaryRecognize: async () => { throw retryable; },
    gatewayRecognize: async () => {
      gatewayCalls += 1;
      return { model: 'openai/gpt-5.6-luna', data: { operations: [] }, diagnostics: [] };
    }
  });

  assert.equal(gatewayCalls, 1);
  assert.equal(result.model, 'openai/gpt-5.6-luna');
  assert.deepEqual(result.diagnostics, ['gemini: HTTP 429', 'gateway fallback: openai/gpt-5.6-luna']);
});

test('provider fallback never hides a permanent recognition error', async () => {
  let gatewayCalls = 0;
  const permanent = Object.assign(new Error('invalid response'), { retryable: false });

  await assert.rejects(
    recognizeCashPhotoWithGatewayFallback({
      primaryRecognize: async () => { throw permanent; },
      gatewayRecognize: async () => { gatewayCalls += 1; }
    }),
    error => error === permanent
  );
  assert.equal(gatewayCalls, 0);
});
