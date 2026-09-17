import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRopDailyControlWorkbook } from '../lib/rop-daily-control.js';

const PLAN = [
  ['Менеджер','Филиал','Филиал АШК','План филиала','Контрольный план менеджера','График','Активен','Примечание'],
  ['Менеджер А','Зарека','Зарека',300000,150000,'5/2','Да',''],
  ['Менеджер Б','Зарека','Зарека',300000,150000,'5/2','Да','']
];
const GROUPS = [{ Id: 10, TrainingRoomName: 'Зарека' }];
const CONTRACTS = new Map([[10, [
  { Id: 101, StudyGroupId: 10, OwnerName: 'Менеджер А', ContractDate: '2026-09-01', SalesSum: 50000, DebitSum: 7000, Debt: 43000 }
]]]);
const PAYMENTS = [
  ['Id','PayDate','StudentId','SaleId','ProductId','ProductName','SaleSum','Debit','PaymentEmployeeName','SaleEmployeeName','SaleAttributionStatus'],
  [501,'2026-09-02 10:00:00',101,10,1,'Курс',50000,7000,'Менеджер А','Менеджер Б','OK_SALE_EMPLOYEE']
];

test('personal KPI follows the ASHK employee who accepted the payment, never the sale employee', () => {
  const workbook = buildRopDailyControlWorkbook({
    planValues: PLAN,
    groups: GROUPS,
    contractsByGroup: CONTRACTS,
    paymentValues: PAYMENTS,
    month: '2026-09',
    asOfDate: '2026-09-02'
  });
  const headers = workbook.controlValues[0];
  const idx = name => headers.indexOf(name);
  const rows = workbook.controlValues.slice(1).filter(row => row[idx('Дата')] === '2026-09-02');
  const row = manager => rows.find(item => item[idx('Менеджер')] === manager);

  assert.equal(row('Менеджер А')[idx('Личный факт за день')], 7000);
  assert.equal(row('Менеджер Б')[idx('Личный факт за день')], 0);
  assert.equal(row('Менеджер А')[idx('Факт филиала за день')], 7000);
  assert.match(JSON.stringify(workbook.paymentAttributionValues), /OK_PAYMENT_EMPLOYEE/);
});
