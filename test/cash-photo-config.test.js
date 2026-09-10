import test from 'node:test';
import assert from 'node:assert/strict';
import { createCashPhotoConfigHttpHandler } from '../lib/cash-photo-config-http.js';

function res() {
  return { code: 200, headers: {}, payload: null,
    setHeader(k,v){ this.headers[String(k).toLowerCase()] = v; },
    status(code){ this.code = code; return this; },
    json(payload){ this.payload = payload; return this; }
  };
}

test('returns branch config for opaque token and no-store', async () => {
  const handler = createCashPhotoConfigHttpHandler({
    authorize: async (token) => token === 'ok' ? { branch: 'Ямская', label: 'Ямская' } : null,
    now: () => new Date('2026-09-10T10:00:00Z'),
    maxBytes: 4_194_304
  });
  const response = res();
  await handler({ method: 'GET', headers: { 'x-cash-photo-token': 'ok' } }, response);
  assert.equal(response.code, 200);
  assert.deepEqual(response.payload, { ok: true, branch: 'Ямская', label: 'Ямская', year: 2026, maxBytes: 4_194_304 });
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('rejects unknown token without revealing branches', async () => {
  const handler = createCashPhotoConfigHttpHandler({ authorize: async () => null });
  const response = res();
  await handler({ method: 'GET', headers: { 'x-cash-photo-token': 'bad' } }, response);
  assert.equal(response.code, 403);
  assert.deepEqual(response.payload, { ok: false, error: 'forbidden' });
});
