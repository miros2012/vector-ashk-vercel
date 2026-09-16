import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createCashPhotoRetryCronHttpHandler
} from '../lib/cash-photo-retry-http.js';
import { createCashPhotoRetryService } from '../lib/cash-photo-retry-service.js';

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

const retrySchedules = [
  '45 21 * * *',
  ...Array.from({ length: 12 }, (_, index) => `15 ${index + 4} * * *`)
];

test('server cron retries a bounded pending batch without a manager token', async () => {
  let received = null;
  const handler = createCashPhotoRetryCronHttpHandler({
    authorizeCron: req => req?.headers?.authorization === 'Bearer cron-secret',
    retryService: {
      async retryPendingConcurrent(limit, filters) {
        received = { limit, filters };
        return { attempted: 3, recognized: 3, stillPending: 0, failed: 0 };
      }
    }
  });
  const res = responseRecorder();

  await handler({ method: 'GET', headers: { authorization: 'Bearer cron-secret' } }, res);

  assert.equal(res.code, 200);
  assert.deepEqual(received, { limit: 3, filters: {} });
  assert.deepEqual(res.payload, {
    ok: true,
    attempted: 3,
    recognized: 3,
    stillPending: 0,
    failed: 0
  });
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('server cron cannot retry photos without cron authorization', async () => {
  let calls = 0;
  const handler = createCashPhotoRetryCronHttpHandler({
    authorizeCron: () => false,
    retryService: { async retryPendingConcurrent() { calls += 1; } }
  });
  const res = responseRecorder();

  await handler({ method: 'GET', headers: {} }, res);

  assert.equal(res.code, 403);
  assert.equal(calls, 0);
});

test('server retry processes three pending photos concurrently to stay inside the health function budget', async () => {
  const photos = ['Ямская-1', 'Ямская-2', 'Мельникайте-1'].map((photoId, index) => ({
    photoId,
    archiveRow: index + 2,
    fileId: `file-${index}`,
    branch: index === 2 ? 'Мельникайте' : 'Ямская',
    year: 2026,
    fileName: `${photoId}.jpg`
  }));
  let active = 0;
  let maxActive = 0;
  const recognized = [];
  const service = createCashPhotoRetryService({
    store: {
      async listPending(limit, filters) {
        assert.equal(limit, 3);
        assert.deepEqual(filters, {});
        return photos;
      },
      async readPhoto(photo) {
        return { imageBytes: Buffer.from(photo.photoId), mimeType: 'image/jpeg' };
      },
      async markRecognizing() {},
      async markRecognized(photo) { recognized.push(photo.photoId); },
      async markPending() {},
      async markFailed() {}
    },
    async recognize() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setImmediate(resolve));
      active -= 1;
      return { model: 'gemini-test', data: { operations: [] } };
    }
  });

  const result = await service.retryPendingConcurrent(3, {});

  assert.equal(maxActive, 3);
  assert.deepEqual([...recognized].sort(), photos.map(photo => photo.photoId).sort());
  assert.deepEqual(result, { attempted: 3, recognized: 3, stillPending: 0, failed: 0 });
});

test('Vercel schedules Hobby-safe recovery on an explicit cron URL independent of the manager browser', async () => {
  const health = await readFile(new URL('../api/health.js', import.meta.url), 'utf8');
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));

  assert.match(health, /retry-cron/);
  assert.match(health, /createCashPhotoRetryCronHttpHandler/);
  const rewrite = vercel.rewrites.find(item => item.source === '/api/cash-photo-retry-cron');
  assert.deepEqual(rewrite, {
    source: '/api/cash-photo-retry-cron',
    destination: '/api/health?cashPhotoRoute=retry-cron'
  });
  const retryCrons = vercel.crons.filter(item => item.path === '/api/cash-photo-retry-cron');
  assert.deepEqual(retryCrons.map(item => item.schedule).sort(), [...retrySchedules].sort());
  assert.ok(retrySchedules.every(schedule => !schedule.includes('/')));
});

test('cash photo cron authorizes before initializing Google-backed services', async () => {
  const health = await readFile(new URL('../api/health.js', import.meta.url), 'utf8');
  const start = health.indexOf('async function handleCashPhotoCronRoute');
  const end = health.indexOf('async function handleHourlyProjectAgent', start);
  const block = health.slice(start, end);
  const authAt = block.indexOf('isAuthorizedCron(req)');
  const servicesAt = block.indexOf('getCashPhotoServices()');
  assert.ok(authAt >= 0 && servicesAt >= 0 && authAt < servicesAt);
});
