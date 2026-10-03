import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRopDailyControlWorkbook } from '../lib/rop-daily-control.js';

test('personal KPI follows PaymentEmployeeName, never SaleEmployeeName or contract owner', () => {
  const workbook = buildRopDailyControlWorkbook({
    planValues: [
      ['Менеджер','Филиал','Филиал АШК','План филиала','Контрольный план менеджера','График','Активен','Примечание'],
      ['Менеджер А','Филиал','Филиал АШК',300000,150000,'5/2','Да',''],
      ['Менеджер Б','Филиал','Филиал АШК',300000,150000,'5/2','Да','']
    ],
    groups: [{ Id: 10, TrainingRoomName: 'Филиал АШК' }],
    contractsByGroup: new Map([[10, [
      { Id: 101, StudyGroupId: 10, OwnerName: 'Менеджер Б', ContractDate: '2026-09-01', SalesSum: 50000, DebitSum: 7000, Debt: 43000 }
    ]]]),
    paymentValues: [
      ['Id','PayDate','StudentId','SaleId','ProductId','ProductName','SaleSum','Debit','PaymentEmployeeName','SaleEmployeeName','SaleAttributionStatus'],
      [501,'2026-09-02 10:00:00',101,10,1,'Курс',50000,7000,'Менеджер А','Менеджер Б','OK_SALE_EMPLOYEE']
    ],
    month: '2026-09',
    asOfDate: '2026-09-02'
  });

  const headers = workbook.controlValues[0];
  const idx = name => headers.indexOf(name);
  const rows = workbook.controlValues.slice(1).filter(row => row[idx('Дата')] === '2026-09-02');
  const managerA = rows.find(row => row[idx('Менеджер')] === 'Менеджер А');
  const managerB = rows.find(row => row[idx('Менеджер')] === 'Менеджер Б');

  assert.equal(managerA[idx('Личный факт за день')], 7000);
  assert.equal(managerB[idx('Личный факт за день')], 0);
  assert.equal(managerA[idx('Факт филиала за день')], 7000);
  assert.match(JSON.stringify(workbook.paymentAttributionValues), /OK_PAYMENT_EMPLOYEE/);
});
