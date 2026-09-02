import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRopPublisher } from '../lib/rop-publisher.js';

const TARGET = '19_UF9JUcFf_jHtpugNgcjasi3SsVcZczlaK_spH7gDQ';

test('ROP publisher copies only the four approved management sheets', async () => {
  const reads = [];
  const writes = [];
  const source = {
    'РОП_Штаб_Утро': [['h1'], ['morning']],
    'РОП_Задачи_Сегодня': [['h1'], ['tasks']],
    'РОП_Контроль_Дня': [['h1'], ['control']],
    'РОП_План_Сентябрь': [['h1'], ['plan']]
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
  assert.equal(result.sheets, 4);
});

test('health route reserves authenticated mirror cron schedules without changing public health behavior', () => {
  const health = readFileSync(new URL('../api/health.js', import.meta.url), 'utf8');
  assert.match(health, /createRopPublisher/);
  assert.match(health, /x-vercel-cron-schedule/i);
  assert.match(health, /CRON_SECRET/);
  assert.match(health, new RegExp(TARGET));
});

test('Vercel schedules ROP publishing five minutes after nightly and intraday refreshes', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const healthCrons = config.crons.filter(cron => cron.path === '/api/health').map(cron => cron.schedule).sort();
  const expected = ['35 21 * * *', ...Array.from({ length: 12 }, (_, index) => `5 ${index + 4} * * *`)].sort();
  assert.deepEqual(healthCrons, expected);
});
