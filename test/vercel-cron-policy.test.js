import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(here, '..', 'vercel.json'), 'utf8'));
const apiDirectory = path.join(here, '..', 'api');
const financePath = '/api/nightly-finance-orchestrator';
const intradaySchedules = Array.from({ length: 12 }, (_, index) => `0 ${index + 4} * * *`);

test('Hobby deployment uses only once-per-day cron expressions', () => {
  assert.ok(Array.isArray(config.crons), 'vercel.json must define crons');
  assert.equal(config.crons.length, 13, 'expected nightly full sync plus 12 daily intraday ROP schedules');
  assert.ok(config.crons.every((cron) => cron.path === financePath), 'all schedules must reuse the same serverless function');
  const schedules = config.crons.map((cron) => cron.schedule);
  assert.deepEqual(schedules.sort(), ['30 21 * * *', ...intradaySchedules].sort());
  assert.ok(!schedules.includes('0 4-15 * * *'), 'Hobby cannot deploy a cron expression that runs more than once per day');
});

test('nightly finance cron schedule is daily at 02:30 Tyumen', () => {
  const cron = config.crons.find((item) => item.schedule === '30 21 * * *');
  assert.ok(cron);
  assert.deepEqual(cron.schedule.trim().split(/\s+/), ['30', '21', '*', '*', '*']);
});

test('intraday ROP uses twelve once-daily UTC schedules covering 09:00 through 20:00 Tyumen', () => {
  const schedules = config.crons.filter((item) => item.schedule !== '30 21 * * *').map((item) => item.schedule);
  assert.deepEqual(schedules.sort(), intradaySchedules.sort());
  assert.ok(config.crons.filter((item) => intradaySchedules.includes(item.schedule)).every((item) => item.path === financePath));
});

test('nightly orchestrator has enough duration for sequential HOURS and decisions stages', () => {
  const duration = Number(config.functions?.['api/nightly-finance-orchestrator.js']?.maxDuration || 0);
  assert.ok(duration >= 120, `nightly orchestrator maxDuration must be at least 120s, got ${duration}s`);
});

test('Hobby Vercel auto-deploys only main to avoid preview build-rate exhaustion', () => {
  const enabled = config.git?.deploymentEnabled || {};
  assert.equal(enabled.main, true, 'main must remain deployable');
  assert.equal(enabled['*'], false, 'all unnamed branches must stay disabled');
  assert.equal(enabled['**/*'], false, 'nested branches must stay disabled');
  assert.equal(enabled['preview-*'], undefined, 'preview branches must not auto-deploy');
  assert.equal(enabled['release-*'], undefined, 'release branches must not auto-deploy');
});

test('Hobby deployment stays within the 12 Serverless Function limit', () => {
  const apiFunctions = fs.readdirSync(apiDirectory).filter((name) => name.endsWith('.js'));
  assert.ok(
    apiFunctions.length <= 12,
    `Hobby plan allows at most 12 Serverless Functions, found ${apiFunctions.length}`
  );
});

test('owner dashboard URLs rewrite to the existing decision-event function', () => {
  const rewrites = config.rewrites || [];
  assert.deepEqual(rewrites, [
    { source: '/api/owner-action', destination: '/api/decision-event?ownerRoute=action' },
    { source: '/api/decision-effectiveness', destination: '/api/decision-event?ownerRoute=effectiveness' },
    { source: '/api/owner-action-queue', destination: '/api/decision-event?ownerRoute=queue' }
  ]);
});
