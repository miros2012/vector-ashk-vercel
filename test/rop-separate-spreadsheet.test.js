import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');

const ROP_SPREADSHEET_ID = '19_UF9JUcFf_jHtpugNgcjasi3SsVcZczlaK_spH7gDQ';

test('ROP management sheets are isolated in the dedicated spreadsheet', () => {
  assert.match(api, new RegExp(`ROP_SPREADSHEET_ID\\s*=\\s*'${ROP_SPREADSHEET_ID}'`));
  assert.match(api, /readValues\(ROP_PLAN_SHEET,\s*'A:H',\s*ROP_SPREADSHEET_ID\)/);
  assert.match(api, /writeValues\(ROP_CONTROL_SHEET,\s*'A:S',[\s\S]*ROP_SPREADSHEET_ID\)/);
  assert.match(api, /writeValues\(ROP_MORNING_SHEET,\s*'A:V',[\s\S]*ROP_SPREADSHEET_ID\)/);
  assert.match(api, /writeValues\(ROP_TASKS_SHEET,\s*'A:P',[\s\S]*ROP_SPREADSHEET_ID\)/);
  assert.match(api, /readValues\(ROP_CONTROL_SHEET,\s*'A:S',\s*ROP_SPREADSHEET_ID\)/);
  assert.match(api, /readValues\(ROP_MORNING_SHEET,\s*'A:V',\s*ROP_SPREADSHEET_ID\)/);
  assert.match(api, /readValues\(ROP_TASKS_SHEET,\s*'A:P',\s*ROP_SPREADSHEET_ID\)/);
});

test('financial staging and diagnostics stay in the private finance spreadsheet', () => {
  assert.match(api, /writeValues\(CURRENT_MONTH_CONTRACTS_SHEET,\s*'A:J'/);
  assert.match(api, /writeValues\(ROP_UNMATCHED_SHEET,\s*'A:G'/);
  assert.match(api, /readValues\(PAYMENTS_STAGING_SHEET,\s*'A:H'/);
  assert.doesNotMatch(api, /writeValues\(ROP_UNMATCHED_SHEET,[\s\S]*ROP_SPREADSHEET_ID/);
});
