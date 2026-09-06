import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerReadonlyApi } from '../lib/owner-readonly-api.js';

function responseRecorder() {
  return {
    code: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function samplePackage() {
  return {
    summary: {
      safeWithdrawal: 0,
      selectedActionCount: 3,
      pendingVerificationCount: 1,
      overdueVerificationCount: 1
    },
    snapshot: { snapshotId: 'owner-2026-09-06' },
    withdrawal: { safeWithdrawal: 0, blocked: true },
    agenda: { actions: [{ id: 'collect-cash' }] },
    verificationQueue: { total: 1, overdueCount: 1, items: [] }
  };
}

test('authorized GET returns the supplied owner package with no-store and exactly one read', async () => {
  let reads = 0;
  const ownerPackage = samplePackage();
  const api = createOwnerReadonlyApi({
    configuredKey: 'secret',
    readOwnerPackage: async () => {
      reads += 1;
      return ownerPackage;
    }
  });
  const req = { method: 'GET', headers: { 'x-vector-key': 'secret' } };
  const res = responseRecorder();

  await api(req, res);

  assert.equal(res.code, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.body, { ok: true, package: ownerPackage });
  assert.equal(reads, 1);
});

test('accepts the existing Bearer authorization pattern', async () => {
  let reads = 0;
  const api = createOwnerReadonlyApi({
    configuredKey: 'secret',
    readOwnerPackage: async () => { reads += 1; return samplePackage(); }
  });
  const res = responseRecorder();

  await api({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
  assert.equal(reads, 1);
});

test('rejects missing or wrong credentials before reading anything', async () => {
  for (const headers of [{}, { 'x-vector-key': 'wrong' }, { authorization: 'Bearer wrong' }]) {
    let reads = 0;
    const api = createOwnerReadonlyApi({
      configuredKey: 'secret',
      readOwnerPackage: async () => { reads += 1; return samplePackage(); }
    });
    const res = responseRecorder();

    await api({ method: 'GET', headers }, res);

    assert.equal(res.code, 403);
    assert.deepEqual(res.body, { ok: false, error: 'forbidden' });
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(reads, 0);
  }
});

test('blank configured key fails closed before reading anything', async () => {
  let reads = 0;
  const api = createOwnerReadonlyApi({
    configuredKey: '   ',
    readOwnerPackage: async () => { reads += 1; return samplePackage(); }
  });
  const res = responseRecorder();

  await api({ method: 'GET', headers: { 'x-vector-key': 'anything' } }, res);

  assert.equal(res.code, 403);
  assert.equal(reads, 0);
});

test('rejects non-GET methods before reading anything and still disables caching', async () => {
  let reads = 0;
  const api = createOwnerReadonlyApi({
    configuredKey: 'secret',
    readOwnerPackage: async () => { reads += 1; return samplePackage(); }
  });
  const res = responseRecorder();

  await api({ method: 'POST', headers: { 'x-vector-key': 'secret' } }, res);

  assert.equal(res.code, 405);
  assert.deepEqual(res.body, { ok: false, error: 'Use GET' });
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(reads, 0);
});

test('validates the read dependency at construction time', () => {
  assert.throws(
    () => createOwnerReadonlyApi({ configuredKey: 'secret' }),
    /readOwnerPackage is required/i
  );
  assert.throws(
    () => createOwnerReadonlyApi({ configuredKey: 'secret', readOwnerPackage: {} }),
    /readOwnerPackage is required/i
  );
});

test('reader failure returns a generic 500 without leaking internal details', async () => {
  let reads = 0;
  const api = createOwnerReadonlyApi({
    configuredKey: 'secret',
    readOwnerPackage: async () => {
      reads += 1;
      throw new Error('spreadsheet customer balance 12345 failed');
    }
  });
  const res = responseRecorder();
  const originalError = console.error;
  console.error = () => {};
  try {
    await api({ method: 'GET', headers: { 'x-vector-key': 'secret' } }, res);
  } finally {
    console.error = originalError;
  }

  assert.equal(res.code, 500);
  assert.deepEqual(res.body, { ok: false, error: 'owner package unavailable' });
  assert.equal(JSON.stringify(res.body).includes('12345'), false);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(reads, 1);
});
