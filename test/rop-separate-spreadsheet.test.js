import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ropPublisher from '../lib/rop-publisher.js';

const { createRopPublisher } = ropPublisher;

const TARGET = '19_UF9JUcFf_jHtpugNgcjasi3SsVcZczlaK_spH7gDQ';

test('ROP publisher copies the approved management sheets including debtor priorities', async () => {
  const reads = [];
  const writes = [];
  const source = {
    'РОП_Штаб_Утро': [['h1'], ['morning']],
    'РОП_Задачи_Сегодня': [['h1'], ['tasks']],
    'РОП_Контроль_Дня': [['h1'], ['control']],
    'РОП_План_Сентябрь': [['h1'], ['plan']],
    'РОП_Дебиторка_Приоритет': [['h1'], ['debtors']]
  };
  const publish = createRopPublisher({
    targetSpreadsheetId: TARGET,
    readSheet: async (sheetName) => { reads.push(sheetName); return source[sheetName]; },
    writeSheet: async (spreadsheetId, sheetName, values) => { writes.push({ spreadsheetId, sheetName, values }); }
  });

  const result = await publish();
  assert.equal(result.ok, true);
  assert.deepEqual(reads, Object.keys(source));
  assert.deepEqual(writes.map(item => item.sheetName), Object.keys(source));
  assert.ok(writes.every(item => item.spreadsheetId === TARGET));
  assert.equal(result.sheets, 5);
});

test('verified ROP source refresh publishes the standalone dashboard immediately', async () => {
  assert.equal(typeof ropPublisher.syncRopSourceThenPublishTarget, 'function');
  const calls = [];
  const result = await ropPublisher.syncRopSourceThenPublishTarget({
    refreshSource: async () => {
      calls.push('source');
      return { ok: true, liveDate: '2026-09-02' };
    },
    publishTarget: async () => {
      calls.push('target');
      return { ok: true, sheets: 4 };
    }
  });

  assert.deepEqual(calls, ['source', 'target']);
  assert.deepEqual(result, {
    ok: true,
    liveDate: '2026-09-02',
    standalonePublished: true,
    standaloneSheets: 4
  });
});

test('health route reserves authenticated mirror cron schedules without changing public health behavior', () => {
  const health = readFileSync(new URL('../api/health.js', import.meta.url), 'utf8');
  assert.match(health, /createRopPublisher/);
  assert.match(health, /x-vercel-cron-schedule/i);
  assert.match(health, /CRON_SECRET/);
  assert.match(health, new RegExp(TARGET));
});

test('Vercel keeps only one nightly standalone ROP fallback after immediate publishing', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const healthCrons = config.crons.filter(cron => cron.path === '/api/health').map(cron => cron.schedule).sort();
  assert.deepEqual(healthCrons, ['35 21 * * *']);
});
