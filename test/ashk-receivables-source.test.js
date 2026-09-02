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

test('receivables source loads groups, skips empty groups, and fetches contracts by StudyGroupId', async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url: String(url), headers: options?.headers });
    if (String(url).endsWith('/api/StudyGroupList')) {
      return jsonResponse({ success: true, data: [
        { Id: 10, TrainingRoomName: 'Герцена', StudentCount: 2 },
        { Id: 20, TrainingRoomName: 'Гондатти', StudentCount: 0 },
        { Id: 30, TrainingRoomName: 'Зарека', StudentCount: 1 }
      ] });
    }
    if (String(url).includes('StudyGroupId=10')) {
      return jsonResponse({ success: true, data: [{ Id: 101, Debt: 1000 }] });
    }
    if (String(url).includes('StudyGroupId=30')) {
      return jsonResponse({ success: true, data: [{ Id: 301, Debt: 2000 }] });
    }
    throw new Error(`unexpected url ${url}`);
  };

  const source = createAshkReceivablesSource({
    fetchFn,
    baseUrl: 'https://app.dscontrol.ru',
    apiKey: 'secret-key',
    concurrency: 2,
    timeoutMs: 5000,
    minIntervalMs: 1
  });

  const result = await source.fetchCurrent();

  assert.equal(result.groups.length, 3);
  assert.deepEqual([...result.contractsByGroup.keys()], [10, 30]);
  assert.equal(result.contractsByGroup.get(10)[0].Id, 101);
  assert.equal(result.contractsByGroup.get(30)[0].Id, 301);
  assert.equal(calls.some(call => call.url.includes('StudyGroupId=20')), false);
  assert.equal(calls.every(call => call.headers?.api_key === 'secret-key'), true);
});

test('receivables source never exceeds configured group request concurrency', async () => {
  let active = 0;
  let maxActive = 0;
  const fetchFn = async (url) => {
    if (String(url).endsWith('/api/StudyGroupList')) {
      return jsonResponse({ success: true, data: [1,2,3,4,5].map(Id => ({ Id, StudentCount: 1 })) });
    }
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active -= 1;
    return jsonResponse({ success: true, data: [] });
  };

  const source = createAshkReceivablesSource({
    fetchFn,
    baseUrl: 'https://app.dscontrol.ru',
    apiKey: 'secret-key',
    concurrency: 2,
    timeoutMs: 5000,
    minIntervalMs: 1
  });

  await source.fetchCurrent();
  assert.equal(maxActive, 2);
});

test('receivables source spaces every ASHK request start to stay under the API rate limit', async () => {
  let clock = 0;
  const starts = [];
  const fetchFn = async (url) => {
    starts.push({ url: String(url), at: clock });
    if (String(url).endsWith('/api/StudyGroupList')) {
      return jsonResponse({ success: true, data: [1,2,3].map(Id => ({ Id, StudentCount: 1 })) });
    }
    return jsonResponse({ success: true, data: [] });
  };

  const source = createAshkReceivablesSource({
    fetchFn,
    baseUrl: 'https://app.dscontrol.ru',
    apiKey: 'secret-key',
    concurrency: 3,
    timeoutMs: 5000,
    minIntervalMs: 350,
    now: () => clock,
    sleep: async (ms) => { clock += ms; }
  });

  await source.fetchCurrent();

  assert.deepEqual(starts.map(item => item.at), [0, 350, 700, 1050]);
});

test('receivables source fails with endpoint-only error when ASHK returns application error', async () => {
  const fetchFn = async (url) => {
    if (String(url).endsWith('/api/StudyGroupList')) {
      return jsonResponse({ success: true, data: [{ Id: 10, StudentCount: 1 }] });
    }
    return jsonResponse({ success: false, data: { Message: 'private ASHK detail' } }, 200);
  };

  const source = createAshkReceivablesSource({
    fetchFn,
    baseUrl: 'https://app.dscontrol.ru',
    apiKey: 'secret-key',
    concurrency: 1,
    timeoutMs: 5000,
    minIntervalMs: 1
  });

  await assert.rejects(
    () => source.fetchCurrent(),
    error => error.message === 'ASHK StudentExternalList failed for group 10'
  );
});
