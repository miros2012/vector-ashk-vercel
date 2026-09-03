import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRopDailyControlWorkbook } from '../lib/rop-daily-control.js';

const planValues = [
  ['Менеджер','Филиал','Филиал АШК','План филиала','Контрольный план менеджера','График','Активен','Примечание'],
  ['Менеджер А','Герцена','Сити-Центр',100000,100000,'5/2','Да','']
];

const paymentValues = [
  [
    'Id','PayDate','StudentId','SaleId','ProductId','ProductName','SaleSum','Debit',
    'PaymentEmployeeName','SaleEmployeeName','SaleAttributionStatus'
  ],
  [11,'2026-09-01 10:00:00',999,1,1,'Доплата',2700,2700,'Кассир','Менеджер А','OK_SALE_EMPLOYEE'],
  [12,'2026-09-01 11:00:00',301,2,1,'Доплата',1500,1500,'Кассир','Менеджер А','OK_SALE_EMPLOYEE']
];

test('ROP workbook emits auditable unmatched-payment rows with distinct root-cause codes', () => {
  const workbook = buildRopDailyControlWorkbook({
    planValues,
    groups: [
      { Id: 10, TrainingRoomName: 'Сити-Центр' },
      { Id: 30, TrainingRoomName: 'Неизвестный филиал' }
    ],
    contractsByGroup: new Map([
      [10, []],
      [30, [{
        Id: 301,
        StudyGroupId: 30,
        OwnerName: 'Старый менеджер',
        ContractDate: '2026-08-01',
        SalesSum: 10000,
        DebitSum: 8500,
        Debt: 1500
      }]]
    ]),
    paymentValues,
    month: '2026-09',
    asOfDate: '2026-09-01'
  });

  assert.deepEqual(workbook.unmatchedPaymentValues, [
    ['ID оплаты','Дата','StudentId','Сумма','Причина','Филиал АШК','Менеджер АШК'],
    ['11','2026-09-01',999,2700,'STUDENT_NOT_IN_CURRENT_SNAPSHOT','',''],
    ['12','2026-09-01',301,1500,'BRANCH_NOT_MAPPED','Неизвестный филиал','Старый менеджер']
  ]);
  assert.equal(workbook.metrics.unmatchedPayments, 2);
  assert.equal(workbook.metrics.unmatchedPaymentAmount, 4200);
});
