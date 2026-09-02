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

test('receivables source can fetch one contract by stable StudentId for ROP fallback', async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url: String(url), headers: options?.headers });
    return jsonResponse({ success: true, data: {
      Id: 3465984,
      StudyGroupId: 123,
      TrainingRoomName: 'Сити-Центр',
      OwnerName: 'Менеджер Б',
      ContractDate: '2025-12-01',
      Debt: 0
    } });
  };

  const source = createAshkReceivablesSource({
    fetchFn,
    baseUrl: 'https://app.dscontrol.ru',
    apiKey: 'secret-key',
    concurrency: 2,
    timeoutMs: 5000,
    minIntervalMs: 1
  });

  const student = await source.fetchStudent(3465984);

  assert.equal(student.Id, 3465984);
  assert.equal(student.TrainingRoomName, 'Сити-Центр');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://app.dscontrol.ru/api/StudentExternalGet?param=3465984');
  assert.equal(calls[0].headers?.api_key, 'secret-key');
});

test('receivables source rejects invalid StudentId before external call', async () => {
  let called = false;
  const source = createAshkReceivablesSource({
    fetchFn: async () => { called = true; return jsonResponse({ success: true, data: {} }); },
    baseUrl: 'https://app.dscontrol.ru',
    apiKey: 'secret-key',
    minIntervalMs: 1
  });

  await assert.rejects(() => source.fetchStudent('not-an-id'), /StudentId/);
  assert.equal(called, false);
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
  const starts = [];
  const fetchFn = async (url) => {
    starts.push(Date.now());
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
    minIntervalMs: 40
  });

  await source.fetchCurrent();

  assert.equal(starts.length, 4);
  for (let index = 1; index < starts.length; index += 1) {
    assert.ok(
      starts[index] - starts[index - 1] >= 25,
      `request ${index + 1} started too soon: ${starts[index] - starts[index - 1]}ms`
    );
  }
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
