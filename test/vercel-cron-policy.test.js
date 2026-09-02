import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(here, '..', 'vercel.json'), 'utf8'));
const apiDirectory = path.join(here, '..', 'api');

test('Hobby deployment config defines exactly one nightly finance orchestrator cron', () => {
  assert.ok(Array.isArray(config.crons), 'vercel.json must define crons');
  assert.equal(config.crons.length, 1, 'Hobby plan must use exactly one daily finance cron');

  const [cron] = config.crons;
  assert.equal(cron.path, '/api/nightly-finance-orchestrator');
  assert.equal(cron.schedule, '30 21 * * *');
});

test('nightly finance cron schedule is daily at 02:30 Tyumen', () => {
  const schedule = config.crons?.[0]?.schedule || '';
  const fields = schedule.trim().split(/\s+/);
  assert.equal(fields.length, 5, 'cron must use a five-field schedule');
  assert.deepEqual(fields, ['30', '21', '*', '*', '*']);
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
