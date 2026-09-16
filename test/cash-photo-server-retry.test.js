import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as retryHttp from '../lib/cash-photo-retry-http.js';

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

test('server cron retries one pending cash photo without a manager token', async () => {
  assert.equal(typeof retryHttp.createCashPhotoRetryCronHttpHandler, 'function');

  let received = null;
  const handler = retryHttp.createCashPhotoRetryCronHttpHandler({
    authorizeCron: req => req?.headers?.authorization === 'Bearer cron-secret',
    retryService: {
      async retryPending(limit, filters) {
        received = { limit, filters };
        return { attempted: 1, recognized: 1, stillPending: 0, failed: 0 };
      }
    }
  });
  const res = responseRecorder();

  await handler({ method: 'GET', headers: { authorization: 'Bearer cron-secret' } }, res);

  assert.equal(res.code, 200);
  assert.deepEqual(received, { limit: 1, filters: {} });
  assert.deepEqual(res.payload, {
    ok: true,
    attempted: 1,
    recognized: 1,
    stillPending: 0,
    failed: 0
  });
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('server cron cannot retry photos without cron authorization', async () => {
  assert.equal(typeof retryHttp.createCashPhotoRetryCronHttpHandler, 'function');

  let calls = 0;
  const handler = retryHttp.createCashPhotoRetryCronHttpHandler({
    authorizeCron: () => false,
    retryService: { async retryPending() { calls += 1; } }
  });
  const res = responseRecorder();

  await handler({ method: 'GET', headers: {} }, res);

  assert.equal(res.code, 403);
  assert.equal(calls, 0);
});

test('Vercel schedules a server-side retry independently of the manager browser', async () => {
  const health = await readFile(new URL('../api/health.js', import.meta.url), 'utf8');
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));

  assert.match(health, /retry-cron/);
  assert.ok(vercel.rewrites.some(item =>
    item.source === '/api/cash-photo-retry-cron'
      && item.destination === '/api/health?cashPhotoRoute=retry-cron'
  ));
  assert.ok(vercel.crons.some(item =>
    item.path === '/api/cash-photo-retry-cron'
      && item.schedule === '*/5 * * * *'
  ));
});
