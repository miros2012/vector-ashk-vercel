import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashPhotoGatewayPayload } from '../lib/cash-photo-prompt.js';

test('builds multimodal structured-output request preserving cash journal rules', () => {
  const payload = buildCashPhotoGatewayPayload({
    imageBytes: Buffer.from([1,2,3]),
    mimeType: 'image/jpeg',
    branch: 'Ямская',
    year: 2026
  });

  assert.equal(payload.stream, false);
  assert.equal(payload.messages[0].role, 'user');
  assert.match(payload.messages[0].content[0].text, /Филиал: Ямская/);
  assert.match(payload.messages[0].content[0].text, /Не классифицируй статью ДДС/);
  assert.match(payload.messages[0].content[0].text, /visibleMoneyRowCount/);
  assert.equal(payload.messages[0].content[1].type, 'image_url');
  assert.equal(payload.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,AQID');
  assert.equal(payload.response_format.type, 'json_schema');
  const schema = payload.response_format.json_schema.schema;
  assert.ok(schema.required.includes('operations'));
  assert.equal(schema.properties.operations.items.additionalProperties, false);
  assert.ok(schema.properties.operations.items.required.includes('needsReview'));
});

test('rejects unsupported image mime types', () => {
  assert.throws(() => buildCashPhotoGatewayPayload({
    imageBytes: Buffer.from([1]), mimeType: 'application/pdf', branch: 'Ямская', year: 2026
  }), /JPEG, PNG or WebP/);
});
