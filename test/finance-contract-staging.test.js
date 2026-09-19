import test from 'node:test';
import assert from 'node:assert/strict';
import { financeSourceRouteHarness, CONTRACT_SHEET, CONTRACT_HEADERS } from './helpers/finance-source-route-harness.js';
import { response } from './helpers/finance-route-harness.js';

for (const initial of ['empty', 'stale']) {
  test(`source refresh bootstraps ${initial} contract staging from one fetched payload before its marker`, async t => {
    const fixture = await financeSourceRouteHarness(t, { initialContracts: initial === 'empty' ? [] : [CONTRACT_HEADERS, [101, '2020-01-01', 'Branch', 'Branch', 'Old', 100000, 0, 100000]] });
    const res = response();
    await fixture.route.runReceivablesNow({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(fixture.tables.get(CONTRACT_SHEET).slice(1).map(row => [row[0], row[6], row[7]]), [[101, 80000, 20000], [102, 50000, 0]]);
    assert.equal(fixture.events.filter(event => event === 'fetch').length, 1);
    assert.ok(fixture.events.indexOf(`read:${CONTRACT_SHEET}`) < fixture.events.indexOf('write:__vercel_control'));
    assert.equal(fixture.events.includes('publish'), false);
    const published = await fixture.route.runIntradayRopNow();
    assert.equal(published.ok, true);
    assert.equal(published.currentMonthContracts, 2);
    const control = fixture.tables.get('РОП_Контроль_Дня');
    const debtColumn = control[0].indexOf('Текущая ДЗ филиала');
    assert.equal(control.at(-1)[debtColumn], 20000);
  });
}

for (const [contractFault, errorClass] of [['write', 'SHEETS_WRITE'], ['read', 'SHEETS_READBACK'], ['mismatch', 'READBACK_MISMATCH']]) {
  test(`contract staging ${contractFault} cannot advance the receivables marker`, async t => {
    const fixture = await financeSourceRouteHarness(t, { contractFault });
    const res = response();
    await fixture.route.runReceivablesNow({ method: 'GET' }, res);
    assert.equal(res.body.errorClass, errorClass);
    assert.equal(fixture.tables.get('__vercel_control')[0][1], 'old-marker');
    assert.equal(fixture.events.includes('publish'), false);
  });
}

test('zero current-month contracts can bootstrap a verified header-only staging snapshot', async t => {
  const fixture = await financeSourceRouteHarness(t, { zeroContracts: true });
  const res = response();
  await fixture.route.runReceivablesNow({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(fixture.tables.get(CONTRACT_SHEET).length, 1);
  assert.equal((await fixture.route.runIntradayRopNow()).ok, true, JSON.stringify(fixture.events));
});

test('real production publish failure cannot invalidate the verified source marker', async t => {
  const fixture = await financeSourceRouteHarness(t, { publishFails: true });
  const res = response();
  await fixture.route.runReceivablesNow({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  const marker = fixture.tables.get('__vercel_control')[0][1];
  assert.notEqual(marker, 'old-marker');
  assert.deepEqual(await fixture.route.runIntradayRopNow(), { ok: false, statusCode: 502, errorClass: 'ROP_PUBLISH', retryable: true });
  assert.equal(fixture.tables.get('__vercel_control')[0][1], marker);
});

test('fresh receivables cannot be overridden by older values for the same staged contract', async t => {
  const fixture = await financeSourceRouteHarness(t);
  await fixture.route.runReceivablesNow({ method: 'GET' }, response());
  fixture.tables.set(CONTRACT_SHEET, [CONTRACT_HEADERS, [101, `${fixture.month}-01`, 'Branch', 'Branch', 'Manager', 100000, 0, 100000, '', 'Current']]);
  assert.equal((await fixture.route.runIntradayRopNow()).ok, true, JSON.stringify(fixture.events));
  const control = fixture.tables.get('РОП_Контроль_Дня');
  assert.equal(control.at(-1)[control[0].indexOf('Текущая ДЗ филиала')], 20000);
});

test('real ROP route success emits no financial aggregates in logs', async t => {
  const logs = [];
  t.mock.method(console, 'log', (...args) => logs.push(args));
  const fixture = await financeSourceRouteHarness(t);
  await fixture.route.runReceivablesNow({ method: 'GET' }, response());
  fixture.tables.set(CONTRACT_SHEET, [CONTRACT_HEADERS, [101, `${fixture.month}-01`, 'Branch', 'Branch', 'Manager', 100000, 80000, 20000, '', 'Current']]);
  assert.equal((await fixture.route.runIntradayRopNow()).ok, true);
  for (const args of logs) {
    assert.equal(typeof args[0], 'object');
    assert.ok(Object.keys(args[0]).every(key => ['stage', 'errorClass', 'attempt', 'retryable'].includes(key)));
  }
});
