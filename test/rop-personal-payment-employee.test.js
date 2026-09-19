import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRopDailyControlWorkbook } from '../lib/rop-daily-control.js';

const planValues = [
  ['Менеджер','Филиал','Филиал АШК','План филиала','Контрольный план менеджера','График','Активен','Примечание'],
  ['Менеджер А','Зарека','Зарека',300000,150000,'5/2','Да',''],
  ['Менеджер Б','Зарека','Зарека',300000,150000,'5/2','Да','']
];

const groups = [{ Id: 10, TrainingRoomName: 'Зарека' }];
const contractsByGroup = new Map([[10, [{
  Id: 101,
  StudyGroupId: 10,
  OwnerName: 'Менеджер А',
  ContractDate: '2026-09-01',
  SalesSum: 50000,
  DebitSum: 10000,
  Debt: 40000
}]]]);

function rowFor(workbook, manager) {
  const headers = workbook.controlValues[0];
  const idx = name => headers.indexOf(name);
  const row = workbook.controlValues.slice(1).find(item =>
    item[idx('Дата')] === '2026-09-02' && item[idx('Менеджер')] === manager
  );
  return { row, idx };
}

test('personal KPI credits PaymentEmployeeName and ignores conflicting sale employee and owner', () => {
  const paymentValues = [
    ['Id','PayDate','StudentId','SaleId','ProductId','ProductName','SaleSum','Debit','PaymentEmployeeName','SaleEmployeeName','SaleAttributionStatus'],
    [501,'2026-09-02 10:00:00',101,10,1,'Курс',50000,7000,'Менеджер А','Менеджер Б','OK_SALE_EMPLOYEE'],
    [502,'2026-09-02 11:00:00',101,11,1,'Курс',50000,3000,'Менеджер Б','','SALE_EMPLOYEE_EMPTY']
  ];
  const workbook = buildRopDailyControlWorkbook({
    planValues,
    groups,
    contractsByGroup,
    paymentValues,
    month: '2026-09',
    asOfDate: '2026-09-02'
  });

  const a = rowFor(workbook, 'Менеджер А');
  const b = rowFor(workbook, 'Менеджер Б');
  assert.equal(a.row[a.idx('Личный факт за день')], 7000);
  assert.equal(b.row[b.idx('Личный факт за день')], 3000);
  assert.equal(a.row[a.idx('Факт филиала за день')], 10000);
  assert.match(JSON.stringify(workbook.paymentAttributionValues), /OK_PAYMENT_EMPLOYEE/);
  assert.doesNotMatch(JSON.stringify(workbook.paymentAttributionValues), /OK_SALE_EMPLOYEE.*Зачтён менеджеру/);
});

test('negative refund stays in branch fact but never reduces manager personal KPI', () => {
  const paymentValues = [
    ['Id','PayDate','StudentId','SaleId','ProductId','ProductName','SaleSum','Debit','PaymentEmployeeName','SaleEmployeeName','SaleAttributionStatus'],
    [601,'2026-09-02 10:00:00',101,10,1,'Курс',50000,10000,'Менеджер А','Менеджер Б','OK_SALE_EMPLOYEE'],
    [602,'2026-09-02 11:00:00',101,10,1,'Курс',50000,-4000,'Менеджер А','Менеджер Б','OK_SALE_EMPLOYEE']
  ];
  const workbook = buildRopDailyControlWorkbook({
    planValues,
    groups,
    contractsByGroup,
    paymentValues,
    month: '2026-09',
    asOfDate: '2026-09-02'
  });

  const a = rowFor(workbook, 'Менеджер А');
  assert.equal(a.row[a.idx('Факт филиала за день')], 6000);
  assert.equal(a.row[a.idx('Личный факт за день')], 10000);
});
