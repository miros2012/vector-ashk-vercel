import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRopDailyControlWorkbook } from '../lib/rop-daily-control.js';

const PLAN_VALUES = [
  ['Менеджер','Филиал','Филиал АШК','План филиала','Контрольный план менеджера','График','Активен','Примечание'],
  ['Менеджер А','Зарека','Зарека',1110000,1110000,'5/2','Да',''],
  ['Менеджер Б','Герцена','Сити-Центр',3800000,1900000,'2/2','Да','общий филиальный план'],
  ['Менеджер В','Герцена','Сити-Центр',3800000,1900000,'2/2','Да','общий филиальный план']
];

const GROUPS = [
  { Id: 10, TrainingRoomName: 'Зарека' },
  { Id: 20, TrainingRoomName: 'Сити-Центр' }
];

const CONTRACTS = new Map([
  [10, [
    { Id: 101, StudyGroupId: 10, OwnerName: 'Старый Менеджер', ContractDate: '2026-08-20', SalesSum: 30000, DebitSum: 20000, Debt: 10000 },
    { Id: 102, StudyGroupId: 10, OwnerName: 'Менеджер А', ContractDate: '2026-09-01', SalesSum: 50000, DebitSum: 50000, Debt: 0 }
  ]],
  [20, [
    { Id: 201, StudyGroupId: 20, OwnerName: 'Менеджер Б', ContractDate: '2026-09-01', SalesSum: 60000, DebitSum: 30000, Debt: 30000 },
    { Id: 202, StudyGroupId: 20, OwnerName: 'Старый Центр', ContractDate: '2026-08-15', SalesSum: 40000, DebitSum: 0, Debt: 40000 }
  ]]
]);

const PAYMENT_VALUES = [
  ['Id','PayDate','StudentId','SaleId','ProductId','ProductName','SaleSum','Debit'],
  [1,'2026-09-01 10:00:00',101,1,1,'Курс',30000,10000],
  [2,'2026-09-01 11:00:00',102,2,1,'Курс',50000,50000],
  [3,'2026-09-01 12:00:00',201,3,1,'Курс',60000,30000],
  [4,'2026-09-01 13:00:00',202,4,1,'Курс',40000,20000],
  [5,'2026-09-02 09:00:00',201,3,1,'Курс',60000,10000]
];

test('ROP workbook reconstructs day-by-day branch and manager performance from current-month ASHK data', () => {
  const workbook = buildRopDailyControlWorkbook({
    planValues: PLAN_VALUES,
    groups: GROUPS,
    contractsByGroup: CONTRACTS,
    paymentValues: PAYMENT_VALUES,
    month: '2026-09',
    asOfDate: '2026-09-02'
  });

  assert.equal(workbook.currentMonthContractsValues.length, 3); // header + 2 September contracts
  assert.deepEqual(workbook.currentMonthContractsValues.slice(1).map(row => row[0]), [102, 201]);

  const headers = workbook.controlValues[0];
  const idx = name => headers.indexOf(name);
  const rows = workbook.controlValues.slice(1);
  const row = (date, manager) => rows.find(r => r[idx('Дата')] === date && r[idx('Менеджер')] === manager);

  const aSep1 = row('2026-09-01', 'Менеджер А');
  assert.ok(aSep1);
  assert.equal(aSep1[idx('Факт филиала за день')], 60000);
  assert.equal(aSep1[idx('Факт филиала с начала месяца')], 60000);
  assert.equal(aSep1[idx('Личный факт за день')], 60000); // one-manager branch owns old receivables too
  assert.equal(aSep1[idx('Новых договоров с начала месяца')], 1);
  assert.equal(aSep1[idx('100% оплаченных новых договоров')], 1);
  assert.equal(aSep1[idx('Текущая ДЗ филиала')], 10000);
  assert.equal(aSep1[idx('Статус филиала')], 'ЗЕЛЁНЫЙ');

  const bSep1 = row('2026-09-01', 'Менеджер Б');
  const cSep1 = row('2026-09-01', 'Менеджер В');
  assert.equal(bSep1[idx('Факт филиала за день')], 50000);
  assert.equal(cSep1[idx('Факт филиала за день')], 50000);
  assert.equal(bSep1[idx('Личный факт за день')], 30000);
  assert.equal(cSep1[idx('Личный факт за день')], 0);
  assert.equal(bSep1[idx('Статус филиала')], 'КРАСНЫЙ');
  assert.match(bSep1[idx('Примечание')], /общий филиальный план/i);

  const bSep2 = row('2026-09-02', 'Менеджер Б');
  assert.equal(bSep2[idx('Факт филиала с начала месяца')], 60000);
  assert.equal(bSep2[idx('Личный факт с начала месяца')], 40000);
});

test('ROP workbook exposes unmatched payment amount instead of silently assigning it', () => {
  const workbook = buildRopDailyControlWorkbook({
    planValues: PLAN_VALUES,
    groups: GROUPS,
    contractsByGroup: CONTRACTS,
    paymentValues: [...PAYMENT_VALUES, [6,'2026-09-01 14:00:00',999,9,1,'Курс',10000,7000]],
    month: '2026-09',
    asOfDate: '2026-09-02'
  });

  assert.equal(workbook.metrics.unmatchedPayments, 1);
  assert.equal(workbook.metrics.unmatchedPaymentAmount, 7000);
});

test('ROP workbook uses targeted student details only as fallback when current snapshot misses a StudentId', () => {
  const paymentValues = [
    ...PAYMENT_VALUES,
    [6,'2026-09-01 14:00:00',999,9,1,'Дополнительное вождение',2700,2700]
  ];
  const fallbackStudents = [{
    Id: 999,
    StudyGroupId: 9990,
    TrainingRoomName: 'Сити-Центр',
    OwnerName: 'Менеджер В',
    ContractDate: '2026-05-01',
    SalesSum: 50000,
    DebitSum: 50000,
    Debt: 0,
    State: 'DRV',
    ContractName: 'old-contract'
  }];

  const workbook = buildRopDailyControlWorkbook({
    planValues: PLAN_VALUES,
    groups: GROUPS,
    contractsByGroup: CONTRACTS,
    fallbackStudents,
    paymentValues,
    month: '2026-09',
    asOfDate: '2026-09-02'
  });

  assert.equal(workbook.metrics.unmatchedPayments, 0);
  assert.equal(workbook.metrics.unmatchedPaymentAmount, 0);
  assert.equal(workbook.metrics.fallbackStudentsUsed, 1);

  const headers = workbook.controlValues[0];
  const idx = name => headers.indexOf(name);
  const rows = workbook.controlValues.slice(1);
  const bSep1 = rows.find(r => r[idx('Дата')] === '2026-09-01' && r[idx('Менеджер')] === 'Менеджер Б');
  const cSep1 = rows.find(r => r[idx('Дата')] === '2026-09-01' && r[idx('Менеджер')] === 'Менеджер В');
  assert.equal(bSep1[idx('Факт филиала за день')], 52700);
  assert.equal(cSep1[idx('Факт филиала за день')], 52700);
  assert.equal(cSep1[idx('Личный факт за день')], 2700);

  // Live current snapshot must win over fallback data for the same StudentId.
  const liveWins = buildRopDailyControlWorkbook({
    planValues: PLAN_VALUES,
    groups: GROUPS,
    contractsByGroup: CONTRACTS,
    fallbackStudents: [{ ...fallbackStudents[0], Id: 201, TrainingRoomName: 'Зарека', OwnerName: 'Менеджер А' }],
    paymentValues: PAYMENT_VALUES,
    month: '2026-09',
    asOfDate: '2026-09-02'
  });
  const liveRows = liveWins.controlValues.slice(1);
  const liveBSep1 = liveRows.find(r => r[idx('Дата')] === '2026-09-01' && r[idx('Менеджер')] === 'Менеджер Б');
  assert.equal(liveBSep1[idx('Факт филиала за день')], 50000);
});
