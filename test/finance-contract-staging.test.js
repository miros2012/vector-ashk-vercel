import test from 'node:test';
import assert from 'node:assert/strict';
import { financeSourceRouteHarness, CONTRACT_SHEET, CONTRACT_HEADERS } from './helpers/finance-source-route-harness.js';
import { response } from './helpers/finance-route-harness.js';
import { ropPlanSheetForMonth } from '../lib/rop-plan-period.js';

test('unapproved October plan does not stop verified receivables from receiving a freshness marker', async t => {
  const fixture = await financeSourceRouteHarness(t);
  fixture.tables.delete(ropPlanSheetForMonth(fixture.month));
  const res = response();
  await fixture.route.runReceivablesNow({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.notEqual(fixture.tables.get('__vercel_control')[0][1], 'old-marker');
  assert.equal(fixture.tables.get(CONTRACT_SHEET).length, 0);
  const rop = await fixture.route.runIntradayRopNow();
  assert.equal(rop.errorClass, 'ROP_PLAN_NOT_APPROVED');
});

test('approved city target reports every ASHK payment while personal target uses payment employee', async t => {
  const fixture = await financeSourceRouteHarness(t);
  const planSheet = ropPlanSheetForMonth(fixture.month);
  fixture.tables.set(planSheet, [
    ['Менеджер','Филиал','Филиал АШК','План филиала','План менеджера','График','Активен','Примечание'],
    ['ИТОГО ГОРОД','','',10000000,'','','Нет','Утверждённый городской план'],
    ['Manager','Branch','Branch',100000,100000,'5/2','Да','Личный план']
  ]);
  fixture.tables.set('АШК_Оплаты__vercel', [
    ['Id','PayDate','StudentId','SaleId','ProductId','ProductName','SaleSum','Debit','PaymentEmployeeName','SaleEmployeeName','SaleAttributionStatus'],
    [991,`${fixture.date} 11:00:00`,999,99,1,'Курс',12345,12345,'Manager','Manager','OK_SALE_EMPLOYEE']
  ]);
  await fixture.route.runReceivablesNow({ method: 'GET' }, response());
  const result = await fixture.route.runIntradayRopNow();
  assert.equal(result.ok, true, JSON.stringify(result));
  const morning = fixture.tables.get('РОП_Штаб_Утро');
  const city = morning.find(row => row[0] === 'СЕГОДНЯ — НА СЕЙЧАС' && row[2] === 'ГОРОД');
  const manager = morning.find(row => row[0] === 'СЕГОДНЯ — НА СЕЙЧАС' && row[3] === 'Manager');
  assert.equal(city[5], 10000000);
  assert.equal(city[7], 12345);
  assert.equal(manager[14], 12345);
});

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
