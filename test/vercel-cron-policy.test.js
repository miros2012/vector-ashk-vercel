import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(here, '..', 'vercel.json'), 'utf8'));
const apiDirectory = path.join(here, '..', 'api');
const financePath = '/api/nightly-finance-orchestrator';
const healthPath = '/api/health';
const cashPhotoRetryPath = '/api/cash-photo-retry-cron';
const intradaySchedules = Array.from({ length: 12 }, (_, index) => `0 ${index + 4} * * *`);
const publishSchedules = ['35 21 * * *'];
const cashPhotoRetrySchedules = [
  '45 21 * * *',
  ...Array.from({ length: 12 }, (_, index) => `15 ${index + 4} * * *`)
];

test('Hobby deployment uses once-per-day cron expressions on bounded routes', () => {
  assert.ok(Array.isArray(config.crons), 'vercel.json must define crons');
  const financeCrons = config.crons.filter((cron) => cron.path === financePath);
  const healthCrons = config.crons.filter((cron) => cron.path === healthPath);
  const cashPhotoCrons = config.crons.filter((cron) => cron.path === cashPhotoRetryPath);
  assert.equal(financeCrons.length, 13, 'expected nightly full sync plus 12 daily intraday ROP schedules');
  assert.equal(healthCrons.length, 1, 'expected one ROP fallback schedule');
  assert.equal(cashPhotoCrons.length, 13, 'expected 13 server-side cash-photo recovery schedules');
  assert.equal(config.crons.length, 27, 'only finance, ROP fallback, and cash-photo recovery routes should be scheduled');
  assert.deepEqual(financeCrons.map((cron) => cron.schedule).sort(), ['30 21 * * *', ...intradaySchedules].sort());
  assert.deepEqual(healthCrons.map((cron) => cron.schedule).sort(), publishSchedules.sort());
  assert.deepEqual(cashPhotoCrons.map((cron) => cron.schedule).sort(), cashPhotoRetrySchedules.sort());
  assert.ok(!config.crons.some((cron) => cron.schedule.includes('-')), 'Hobby cron expressions must not use ranges');
  assert.ok(!config.crons.some((cron) => cron.schedule.includes('/')), 'Hobby cron expressions must not use interval syntax');
});

test('nightly finance cron schedule is daily at 02:30 Tyumen', () => {
  const cron = config.crons.find((item) => item.path === financePath && item.schedule === '30 21 * * *');
  assert.ok(cron);
  assert.deepEqual(cron.schedule.trim().split(/\s+/), ['30', '21', '*', '*', '*']);
});

test('intraday ROP uses twelve once-daily UTC schedules covering 09:00 through 20:00 Tyumen', () => {
  const schedules = config.crons
    .filter((item) => item.path === financePath && item.schedule !== '30 21 * * *')
    .map((item) => item.schedule);
  assert.deepEqual(schedules.sort(), intradaySchedules.sort());
});

test('ROP publisher keeps a nightly fallback after immediate source-to-target publishing', () => {
  const schedules = config.crons.filter((item) => item.path === healthPath).map((item) => item.schedule);
  assert.deepEqual(schedules, publishSchedules);
});

test('cash photo recovery runs independently after intraday finance and once overnight', () => {
  const schedules = config.crons.filter((item) => item.path === cashPhotoRetryPath).map((item) => item.schedule);
  assert.deepEqual(schedules.sort(), cashPhotoRetrySchedules.sort());
});

test('nightly orchestrator has enough duration for sequential HOURS and decisions stages', () => {
  const duration = Number(config.functions?.['api/nightly-finance-orchestrator.js']?.maxDuration || 0);
  assert.ok(duration >= 120, `nightly orchestrator maxDuration must be at least 120s, got ${duration}s`);
});

test('health function has enough duration for one bounded concurrent cash-photo recovery batch', () => {
  const duration = Number(config.functions?.['api/health.js']?.maxDuration || 0);
  assert.ok(duration >= 60, `health maxDuration must be at least 60s, got ${duration}s`);
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

test('friendly URLs rewrite to existing serverless functions only', () => {
  const rewrites = config.rewrites || [];
  assert.deepEqual(rewrites, [
    { source: '/api/owner-action', destination: '/api/decision-event?ownerRoute=action' },
    { source: '/api/decision-effectiveness', destination: '/api/decision-event?ownerRoute=effectiveness' },
    { source: '/api/owner-action-queue', destination: '/api/decision-event?ownerRoute=queue' },
    { source: '/api/owner-package', destination: '/api/decision-event?ownerRoute=package' },
    { source: '/api/owner-dashboard-session', destination: '/api/decision-event?ownerRoute=dashboard-session' },
    { source: '/api/owner-dashboard-data', destination: '/api/decision-event?ownerRoute=dashboard-data' },
    { source: '/api/owner-dashboard-google', destination: '/api/decision-event?ownerRoute=dashboard-google' },
    { source: '/api/cash-photo-retry-cron', destination: '/api/health?cashPhotoRoute=retry-cron' }
  ]);
});
