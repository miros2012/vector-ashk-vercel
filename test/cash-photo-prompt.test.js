import test from 'node:test';
import assert from 'node:assert/strict';
import * as promptModule from '../lib/cash-photo-prompt.js';
const buildCashPhotoGeminiPayload = (...args) => promptModule.buildCashPhotoGeminiPayload(...args);

test('builds multimodal structured-output request preserving cash journal rules', () => {
  const payload = buildCashPhotoGeminiPayload({
    imageBytes: Buffer.from([1,2,3]),
    mimeType: 'image/jpeg',
    branch: 'Ямская',
    year: 2026
  });

  assert.equal(payload.messages, undefined);
  assert.equal(payload.contents[0].role, 'user');
  assert.match(payload.contents[0].parts[0].text, /Филиал: Ямская/);
  assert.match(payload.contents[0].parts[0].text, /Не классифицируй статью ДДС/);
  assert.match(payload.contents[0].parts[0].text, /visibleMoneyRowCount/);
  assert.deepEqual(payload.contents[0].parts[1].inlineData, { mimeType: 'image/jpeg', data: 'AQID' });
  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
  const schema = payload.generationConfig.responseJsonSchema;
  assert.ok(schema.required.includes('operations'));
  assert.equal(schema.properties.operations.items.additionalProperties, false);
  assert.ok(schema.properties.operations.items.required.includes('needsReview'));
});

test('rejects unsupported image mime types', () => {
  assert.throws(() => buildCashPhotoGeminiPayload({
    imageBytes: Buffer.from([1]), mimeType: 'application/pdf', branch: 'Ямская', year: 2026
  }), /JPEG, PNG or WebP/);
});
