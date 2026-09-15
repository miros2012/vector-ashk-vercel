import test from 'node:test';
import assert from 'node:assert/strict';
import { createAshkReceivablesSource } from '../lib/ashk-receivables-source.js';

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
