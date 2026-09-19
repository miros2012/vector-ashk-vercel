import test from 'node:test';
import assert from 'node:assert/strict';
import { createAshkReceivablesSource } from '../lib/ashk-receivables-source.js';
import { createReceivablesSyncHandler } from '../lib/receivables-sync-handler.js';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); }
  };
}

test('receivables source recovers from one transient StudyGroupList 500', async () => {
  let calls = 0;
  const source = createAshkReceivablesSource({
    fetchFn: async url => {
      calls += 1;
      if (calls === 1) return jsonResponse({ success: false }, 500);
      assert.ok(String(url).endsWith('/api/StudyGroupList'));
      return jsonResponse({ success: true, data: [] });
    },
    baseUrl: 'https://app.dscontrol.ru',
    apiKey: 'secret-key',
    concurrency: 1,
    timeoutMs: 1000,
    minIntervalMs: 1,
    sleep: async () => {}
  });

  const result = await source.fetchCurrent();
  assert.equal(calls, 2);
  assert.deepEqual(result.groups, []);
});

test('receivables source does not retry permanent StudyGroupList 400', async () => {
  let calls = 0;
  const source = createAshkReceivablesSource({
    fetchFn: async () => {
      calls += 1;
      return jsonResponse({ success: false }, 400);
    },
    baseUrl: 'https://app.dscontrol.ru',
    apiKey: 'secret-key',
    concurrency: 1,
    timeoutMs: 1000,
    minIntervalMs: 1,
    sleep: async () => {}
  });

  await assert.rejects(() => source.fetchCurrent(), /ASHK StudyGroupList failed/);
  assert.equal(calls, 1);
});

for (const [name, response, wantClass, wantStatus, retryable] of [
  ['authentication', () => jsonResponse({ message: 'PRIVATE_TOKEN' }, 401), 'AUTH', 401, false],
  ['HTTP validation', () => jsonResponse({ message: 'PRIVATE_STUDENT' }, 422), 'VALIDATION', 422, false],
  ['payload validation', () => jsonResponse({ success: false, message: 'PRIVATE_STUDENT' }), 'VALIDATION', 422, false],
  ['malformed list', () => jsonResponse({ success: true, data: { private: 'PRIVATE_STUDENT' } }), 'VALIDATION', 422, false],
  ['rate limit', () => jsonResponse({ message: 'PRIVATE_TOKEN' }, 429), 'ASHK_FETCH', 502, true],
  ['server failure', () => jsonResponse({ message: 'PRIVATE_TOKEN' }, 503), 'ASHK_FETCH', 502, true],
  ['network failure', () => { throw new Error('PRIVATE_TOKEN'); }, 'ASHK_FETCH', 502, true]
]) {
  test(`real ASHK ${name} metadata reaches the source handler without raw details`, async () => {
    const source = createAshkReceivablesSource({ apiKey: 'unused', fetchFn: async () => response(), sleep: async () => {} });
    let writes = 0;
    const handler = createReceivablesSyncHandler({
      fetchCurrent: source.fetchCurrent,
      writeDetail: async () => { writes += 1; }, writeSummary: async () => { writes += 1; },
      readDetail: async () => [], readSummary: async () => []
    });
    const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'GET' }, res);
    assert.deepEqual(res.body, { ok: false, statusCode: wantStatus, errorClass: wantClass, retryable });
    assert.equal(writes, 0);
    assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE/);
  });
}
