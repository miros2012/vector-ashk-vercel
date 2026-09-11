import test from 'node:test';
import assert from 'node:assert/strict';
import { createCashPhotoRetryHttpHandler } from '../lib/cash-photo-retry-http.js';

function responseRecorder() {
  return {
    code: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('retry route derives branch from token and forwards optional photo id', async () => {
  let received;
  const handler = createCashPhotoRetryHttpHandler({
    authorize: async (token) => token === 'branch-token' ? { branch: 'Ямская' } : null,
    retryService: {
      async retryPending(limit, filters) {
        received = { limit, filters };
        return { attempted: 1, recognized: 1, stillPending: 0, failed: 0 };
      }
    }
  });
  const res = responseRecorder();
  await handler({
    method: 'POST',
    headers: { 'x-cash-photo-token': 'branch-token', 'x-cash-photo-id': 'PHOTO-1' }
  }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(received, { limit: 1, filters: { branch: 'Ямская', photoId: 'PHOTO-1' } });
  assert.deepEqual(res.payload, { ok: true, attempted: 1, recognized: 1, stillPending: 0, failed: 0 });
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('retry route rejects unknown token without calling recognition', async () => {
  let calls = 0;
  const handler = createCashPhotoRetryHttpHandler({
    authorize: async () => null,
    retryService: { async retryPending() { calls += 1; } }
  });
  const res = responseRecorder();
  await handler({ method: 'POST', headers: { 'x-cash-photo-token': 'bad' } }, res);
  assert.equal(res.code, 403);
  assert.equal(calls, 0);
});

test('retired GET recovery and diagnostic requests cannot invoke work', async () => {
  for (const url of [
    '/api/health?cashPhotoRoute=retry&recovery=YAMSKAYA_20260910',
    '/api/health?cashPhotoRoute=retry&diagnostic=GOOGLE_OAUTH',
    '/api/health?cashPhotoRoute=retry&recovery=OTHER',
    '/api/health?cashPhotoRoute=retry'
  ]) {
    let calls = 0;
    const handler = createCashPhotoRetryHttpHandler({
      authorize: async () => { calls++; return null; },
      retryService: { async retryPending() { calls++; return { attempted: 1 }; } },
      probeGoogleOauth: async () => { calls++; return { ok: true }; }
    });
    const res = responseRecorder();
    await handler({ method: 'GET', url, headers: {} }, res);
    assert.equal(res.code, 405);
    assert.equal(res.headers.allow, 'POST');
    assert.equal(calls, 0);
  }
});

test('legacy query flags cannot bypass authorization on POST', async () => {
  let calls = 0;
  const handler = createCashPhotoRetryHttpHandler({
    authorize: async () => null,
    retryService: { async retryPending() { calls++; } }
  });
  const res = responseRecorder();
  await handler({method:'POST',url:'/api/health?cashPhotoRoute=retry&recovery=YAMSKAYA_20260910&diagnostic=GOOGLE_OAUTH',headers:{}},res);
  assert.equal(res.code,403);
  assert.equal(calls,0);
});
