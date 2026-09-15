import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRopDailyControlWorkbook } from '../lib/rop-daily-control.js';

const PLAN_VALUES = [
  ['Менеджер','Филиал','Филиал АШК','План филиала','План менеджера','График','Активен','Примечание'],
  ['Антонова Карина','Монтажников','Монтажников',750000,750000,'5/2','Да','']
];

const GROUPS = [{ Id: 10, TrainingRoomName: 'Монтажников' }];

const CONTRACTS = new Map([[10, [
  {
    Id: 100,
    StudyGroupId: 10,
    OwnerName: 'Антонова Карина',
    ContractDate: '2026-08-31',
    SalesSum: 48267,
    DebitSum: 48267,
    Debt: 0,
    State: 'DRV',
    ContractName: 'AUG-SALE'
  },
  {
    Id: 101,
    StudyGroupId: 10,
    OwnerName: 'Антонова Карина',
    ContractDate: '2026-09-07',
    SalesSum: 49650,
    DebitSum: 49650,
    Debt: 0,
    State: 'DRV',
    ContractName: 'SEP-SALE'
  }
]]);

const PAYMENT_VALUES = [
  [
    'Id','PayDate','StudentId','SaleId','ProductId','ProductName','SaleSum','Debit',
    'PaymentEmployeeName','SaleEmployeeName','SaleAttributionStatus'
  ],
  [1,'2026-09-07 10:00:00',101,7001,1,'Курс',49650,49650,'','Антонова Карина','OK_SALE_EMPLOYEE'],
  [2,'2026-09-14 10:00:00',100,7000,1,'Курс',48267,-48267,'','Антонова Карина','OK_SALE_EMPLOYEE']
];

test('refund stays in branch cash fact but does not reduce manager personal KPI', () => {
  const workbook = buildRopDailyControlWorkbook({
    planValues: PLAN_VALUES,
    groups: GROUPS,
    contractsByGroup: CONTRACTS,
    paymentValues: PAYMENT_VALUES,
    month: '2026-09',
    asOfDate: '2026-09-14'
  });

  const headers = workbook.controlValues[0];
  const idx = name => headers.indexOf(name);
  const row = workbook.controlValues.slice(1).find(item =>
    item[idx('Дата')] === '2026-09-14' && item[idx('Менеджер')] === 'Антонова Карина'
  );

  assert.ok(row);
  assert.equal(row[idx('Факт филиала с начала месяца')], 1383);
  assert.equal(row[idx('Личный факт с начала месяца')], 49650);
});
