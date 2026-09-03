import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceivableRows, buildReceivableSummary } from '../lib/ashk-receivables.js';

test('buildReceivableRows maps group branch, normalizes amounts, and keeps only positive debt', () => {
  const groups = [
    { Id: 10, TrainingRoomName: 'Герцена' },
    { Id: 20, TrainingRoomName: 'Гондатти' }
  ];
  const contractsByGroup = new Map([
    [10, [
      {
        Id: 101,
        PersonName: 'Иванов Иван Иванович',
        StudyGroupId: 10,
        OwnerName: 'Менеджер А',
        ContractName: 'A-101',
        ContractDate: '2026-08-01',
        State: 'LRN',
        SalesSum: '100000,50',
        DebitSum: 70000,
        Debt: '30000,50',
        MainProductDebt: 25000,
        MainProductName: 'Категория B',
        LastPaymentDate: '2026-08-29'
      },
      {
        Id: 102,
        StudyGroupId: 10,
        OwnerName: 'Менеджер А',
        SalesSum: 50000,
        DebitSum: 50000,
        Debt: 0
      }
    ]],
    [20, [{
      Id: 201,
      StudyGroupId: 20,
      OwnerName: 'Менеджер Б',
      ContractName: 'B-201',
      ContractDate: '2026-07-15',
      State: 'DRV',
      SalesSum: 80000,
      DebitSum: 60000,
      Debt: 20000,
      MainProductDebt: 20000,
      MainProductName: 'Категория B'
    }]]
  ]);

  const rows = buildReceivableRows(groups, contractsByGroup);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.studentId), [101, 201]);
  assert.equal(rows[0].branch, 'Герцена');
  assert.equal(rows[0].studentName, 'Иванов Иван Иванович');
  assert.equal(rows[0].manager, 'Менеджер А');
  assert.equal(rows[0].salesSum, 100000.5);
  assert.equal(rows[0].debitSum, 70000);
  assert.equal(rows[0].debt, 30000.5);
  assert.equal(rows[1].branch, 'Гондатти');
  assert.equal(rows[1].debt, 20000);
});

test('buildReceivableSummary returns total, manager, and branch aggregates', () => {
  const rows = [
    { studentId: 1, manager: 'Менеджер А', branch: 'Герцена', debt: 30000.5, salesSum: 100000.5, debitSum: 70000 },
    { studentId: 2, manager: 'Менеджер А', branch: 'Герцена', debt: 10000, salesSum: 50000, debitSum: 40000 },
    { studentId: 3, manager: 'Менеджер Б', branch: 'Гондатти', debt: 20000, salesSum: 80000, debitSum: 60000 }
  ];

  const summary = buildReceivableSummary(rows);

  assert.deepEqual(summary.total, {
    contracts: 3,
    debt: 60000.5,
    salesSum: 230000.5,
    debitSum: 170000
  });
  assert.deepEqual(summary.byManager, [
    { manager: 'Менеджер А', contracts: 2, debt: 40000.5, salesSum: 150000.5, debitSum: 110000 },
    { manager: 'Менеджер Б', contracts: 1, debt: 20000, salesSum: 80000, debitSum: 60000 }
  ]);
  assert.deepEqual(summary.byBranch, [
    { branch: 'Герцена', contracts: 2, debt: 40000.5, salesSum: 150000.5, debitSum: 110000 },
    { branch: 'Гондатти', contracts: 1, debt: 20000, salesSum: 80000, debitSum: 60000 }
  ]);
});
