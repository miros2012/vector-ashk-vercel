import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCashPhotoAccessStore } from '../lib/cash-photo-access-store.js';
import { createCashPhotoConfigHttpHandler } from '../lib/cash-photo-config-http.js';
import { createCashPhotoUploadHttpHandler } from '../lib/cash-photo-upload-http.js';
import { createCashPhotoRetryHttpHandler } from '../lib/cash-photo-retry-http.js';

const sharedToken = 's'.repeat(43);
const branchToken = 'b'.repeat(43);
const hash = value => createHash('sha256').update(value).digest('hex');
const entries = [
  { accessId: 'BRANCH:Y', branch: 'Ямская', label: 'Ямская', active: true, tokenSha256: hash(branchToken) },
  { accessId: 'BRANCH:H', branch: 'Герцена', label: 'Герцена', active: true, tokenSha256: hash('h'.repeat(43)) },
  { accessId: 'BRANCH:OLD', branch: 'Закрытый', active: false, tokenSha256: hash('x'.repeat(43)) }
];

function access(overrides = {}) {
  return createCashPhotoAccessStore({ registryJson: JSON.stringify(entries), sharedTokenSha256: hash(sharedToken), ...overrides });
}
function response() {
  return { code: 200, headers: {}, payload: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}
function request(branch, token = sharedToken) {
  return { method: 'POST', headers: {
    'x-cash-photo-token': token, 'x-cash-branch': encodeURIComponent(branch),
    'x-cash-year': '2026', 'x-cash-file-name': 'test.png', 'content-type': 'image/png'
  }, body: Buffer.from('synthetic image') };
}

test('shared link config offers only active branches without exposing credentials', async () => {
  const store = access();
  const handler = createCashPhotoConfigHttpHandler({ authorize: token => store.authorize(token), now: () => new Date('2026-09-12') });
  const res = response();
  await handler({ method: 'GET', headers: { 'x-cash-photo-token': sharedToken } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.payload, { ok: true, branches: [
    { branch: 'Ямская', label: 'Ямская' }, { branch: 'Герцена', label: 'Герцена' }
  ], year: 2026, maxBytes: 4194304 });
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('one shared link uploads to either selected authorized branch', async () => {
  const store = access();
  const saved = [];
  const handler = createCashPhotoUploadHttpHandler({ authorize: token => store.authorize(token), uploadService: {
    async upload(input) { saved.push(input); return { statusCode: 200, body: { ok: true, saved: true, photoId: 'PHOTO-TEST' } }; }
  } });
  for (const branch of ['Ямская', 'Герцена']) {
    const res = response();
    await handler(request(branch), res);
    assert.equal(res.code, 200);
    assert.equal(res.payload.saved, true);
  }
  assert.deepEqual(saved.map(item => item.branch), ['Ямская', 'Герцена']);
  assert.deepEqual(saved[0].imageBytes, Buffer.from('synthetic image'));
});

test('shared retry stays scoped to the selected branch and photo', async () => {
  const store = access();
  let received;
  const handler = createCashPhotoRetryHttpHandler({ authorize: token => store.authorize(token), retryService: {
    async retryPending(limit, filters) { received = { limit, filters }; return { recognized: 1 }; }
  } });
  const req = request('Герцена');
  req.headers['x-cash-photo-id'] = 'PHOTO-TEST';
  const res = response();
  await handler(req, res);
  assert.equal(res.code, 200);
  assert.deepEqual(received, { limit: 1, filters: { branch: 'Герцена', photoId: 'PHOTO-TEST' } });
});

test('missing, unknown, disabled and malformed branch selections cannot upload or retry', async () => {
  const store = access();
  let calls = 0;
  const dependencies = { authorize: token => store.authorize(token),
    uploadService: { async upload() { calls++; } }, retryService: { async retryPending() { calls++; } } };
  for (const handler of [createCashPhotoUploadHttpHandler(dependencies), createCashPhotoRetryHttpHandler(dependencies)]) {
    for (const branch of ['', 'Другой', 'Закрытый', '%broken']) {
      const res = response();
      await handler(request(branch), res);
      assert.equal(res.code, 403);
    }
  }
  assert.equal(calls, 0);
});

test('shared credential fails closed without an active private registry or after key revocation', async () => {
  for (const overrides of [
    { registryJson: '' }, { registryJson: '{broken' }, { registryJson: JSON.stringify(entries.map(row => ({ ...row, active: false }))) },
    { sharedTokenSha256: '' }, { sharedTokenSha256: 'bad' }, { sharedTokenSha256: hash('new'.repeat(20)) }
  ]) assert.equal(await access(overrides).authorize(sharedToken), null);
  assert.equal(await access().authorize(hash(sharedToken)), null);
  assert.equal(await access().authorize('z'.repeat(43)), null);
});

test('existing branch link remains fixed to its branch even with a different selection', async () => {
  const store = access();
  let received;
  const handler = createCashPhotoUploadHttpHandler({ authorize: token => store.authorize(token), uploadService: {
    async upload(input) { received = input; return { body: { ok: true } }; }
  } });
  const res = response();
  await handler(request('Герцена', branchToken), res);
  assert.equal(res.code, 200);
  assert.equal(received.branch, 'Ямская');
});
