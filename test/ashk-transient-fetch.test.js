import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAshkWithRetry, isTransientAshkStatus } from '../lib/ashk-transient-fetch.js';

function response(status) {
  return { ok: status >= 200 && status < 300, status };
}

test('ASHK retry treats rate-limit and 5xx as transient only', () => {
  assert.equal(isTransientAshkStatus(429), true);
  assert.equal(isTransientAshkStatus(500), true);
  assert.equal(isTransientAshkStatus(503), true);
  assert.equal(isTransientAshkStatus(400), false);
  assert.equal(isTransientAshkStatus(404), false);
});

test('ASHK fetch retries one transient 500 and returns the recovered response', async () => {
  const statuses = [500, 200];
  const calls = [];
  const waits = [];
  const result = await fetchAshkWithRetry({
    fetchFn: async () => {
      calls.push('fetch');
      return response(statuses.shift());
    },
    url: 'https://app.dscontrol.ru/api/test',
    maxAttempts: 2,
    retryDelayMs: 10,
    sleep: async ms => waits.push(ms)
  });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [10]);
});

test('ASHK fetch does not retry permanent 4xx', async () => {
  let calls = 0;
  const result = await fetchAshkWithRetry({
    fetchFn: async () => { calls += 1; return response(400); },
    url: 'https://app.dscontrol.ru/api/test',
    maxAttempts: 2,
    sleep: async () => { throw new Error('must not sleep'); }
  });
  assert.equal(result.status, 400);
  assert.equal(calls, 1);
});

test('ASHK fetch re-enters rate gate before every attempt', async () => {
  const order = [];
  const statuses = [503, 200];
  await fetchAshkWithRetry({
    fetchFn: async () => { order.push('fetch'); return response(statuses.shift()); },
    url: 'https://app.dscontrol.ru/api/test',
    maxAttempts: 2,
    retryDelayMs: 1,
    beforeAttempt: async attempt => order.push(`gate-${attempt}`),
    sleep: async () => order.push('delay')
  });
  assert.deepEqual(order, ['gate-1', 'fetch', 'delay', 'gate-2', 'fetch']);
});
