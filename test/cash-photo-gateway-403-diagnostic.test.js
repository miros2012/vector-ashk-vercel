import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeCashPhotoViaGateway } from '../lib/cash-photo-gateway-fallback.js';

function payload() {
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
        properties: { operations: { type: 'array', items: { type: 'object' } } },
        required: ['operations']
      }
    }
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

test('cash photo gateway preserves only a sanitized standard 403 reason in diagnostics', async () => {
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/v1/models')) {
      return response(200, {
        data: [
          { id: 'openai/gpt-5.6-luna', modalities: { input: ['text', 'image'], output: ['text'] } },
          { id: 'anthropic/claude-sonnet-5', modalities: { input: ['text', 'image'], output: ['text'] } }
        ]
      });
    }
    const request = JSON.parse(options.body);
    return response(403, request.model === 'openai/gpt-5.6-luna'
      ? {
          type: 'customer_verification_required',
          error: 'Sensitive upstream explanation that must never enter archive diagnostics.'
        }
      : {
          error: { type: 'no_providers_available', message: 'Another sensitive upstream explanation.' }
        });
  };

  await assert.rejects(
    recognizeCashPhotoViaGateway({ gatewayToken: 'oidc-token', payload: payload(), fetchImpl }),
    error => {
      assert.equal(error.retryable, true);
      assert.deepEqual(error.diagnostics, [
        'openai/gpt-5.6-luna: HTTP 403 customer_verification_required',
        'anthropic/claude-sonnet-5: HTTP 403 no_providers_available'
      ]);
      assert.doesNotMatch(JSON.stringify(error.diagnostics), /Sensitive upstream|Another sensitive/i);
      return true;
    }
  );
});

test('cash photo gateway discards unsafe 403 reason strings', async () => {
  const fetchImpl = async (url) => String(url).endsWith('/v1/models')
    ? response(200, {
        data: [
          { id: 'openai/gpt-5.6-luna', modalities: { input: ['text', 'image'], output: ['text'] } }
        ]
      })
    : response(403, { type: 'secret/value with spaces', error: 'private details' });

  await assert.rejects(
    recognizeCashPhotoViaGateway({ gatewayToken: 'oidc-token', payload: payload(), fetchImpl }),
    error => {
      assert.deepEqual(error.diagnostics, ['openai/gpt-5.6-luna: HTTP 403']);
      return true;
    }
  );
});
