import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(here, '..', 'vercel.json'), 'utf8'));

test('Hobby deployment config defines exactly one daily Decision Engine reconciliation cron', () => {
  assert.ok(Array.isArray(config.crons), 'vercel.json must define crons');
  assert.equal(config.crons.length, 1, 'Hobby plan must use exactly one daily safety cron');

  const [cron] = config.crons;
  assert.equal(cron.path, '/api/decision-reconcile-daily');
  assert.equal(cron.schedule, '15 0 * * *');
});

test('daily cron schedule is not minute- or hourly-recurring', () => {
  const schedule = config.crons?.[0]?.schedule || '';
  const fields = schedule.trim().split(/\s+/);
  assert.equal(fields.length, 5, 'cron must use a five-field schedule');
  assert.notEqual(fields[0], '*', 'minute field cannot be wildcard');
  assert.notEqual(fields[1], '*', 'hour field cannot be wildcard');
  assert.equal(fields[2], '*');
  assert.equal(fields[3], '*');
  assert.equal(fields[4], '*');
});
