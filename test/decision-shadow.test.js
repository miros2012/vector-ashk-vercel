import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDecisionFinancialSnapshot,
  compareDecisionShadow
} from '../lib/decision-shadow.js';

const now = new Date('2026-08-31T17:00:00.000Z');

test('shadow mode reproduces all four current decision states from a standard financial snapshot', () => {
  const snapshot = buildDecisionFinancialSnapshot({
    asOfDate: '2026-08-31',
    cashGapAmount: 0,
    cashGapDate: '2026-09-06',
    adjustmentRows: [
      { obligationId: 'MASTERS-2026-08', direction: 'Уменьшение', amount: 500000, status: 'Оценка' },
      { obligationId: 'MASTERS-2026-08', direction: 'Уменьшение', amount: 357000, status: 'Оценка' }
    ],
    obligationRows: [
      { id: 'ROYALTY-2026-08', dueDate: '2026-09-03', remaining: 1179607.46625, priority: 'Критический', status: 'План' },
      { id: 'MASTERS-2026-08', dueDate: '2026-09-05', remaining: 1477773.5, priority: 'Критический', status: 'Оценка net' },
      { id: 'ADMIN-2026-08', dueDate: '2026-09-05', remaining: 500000, priority: 'Критический', status: 'Оценка' },
      { id: 'TAX-RESERVE', dueDate: '2026-09-05', remaining: 0, priority: 'Высокий', status: 'Требует расчёта' }
    ]
  });

  const catalog = [
    { ruleId: 'DEC-CASH-GAP', evaluatorKey: 'cash_gap_30d', enabled: true, version: 1 },
    { ruleId: 'DEC-EST-ADJ', evaluatorKey: 'estimated_obligation_adjustments', enabled: true, version: 1 },
    { ruleId: 'DEC-UNCONF-OBL', evaluatorKey: 'unconfirmed_obligations', enabled: true, version: 1 },
    { ruleId: 'DEC-CRIT-DUE', evaluatorKey: 'critical_payment_due_3d', enabled: true, version: 1 }
  ];

  const currentDecisions = [
    { ruleId: 'DEC-CASH-GAP', active: false, amount: 0, dueDate: null, linkedObjects: [] },
    { ruleId: 'DEC-EST-ADJ', active: true, amount: 857000, dueDate: null, linkedObjects: ['MASTERS-2026-08'] },
    { ruleId: 'DEC-UNCONF-OBL', active: true, amount: 500000, dueDate: null, linkedObjects: ['ADMIN-2026-08', 'TAX-RESERVE'] },
    { ruleId: 'DEC-CRIT-DUE', active: true, amount: 1179607.46625, dueDate: '2026-09-03', linkedObjects: ['ROYALTY-2026-08'] }
  ];

  const comparison = compareDecisionShadow({ catalog, snapshot, currentDecisions, now });

  assert.equal(comparison.total, 4);
  assert.equal(comparison.matches, 4);
  assert.deepEqual(comparison.mismatches, []);
  assert.equal(comparison.results.find((row) => row.ruleId === 'DEC-CRIT-DUE').shadow.amount, 1179607.46625);
  assert.equal(snapshot.obligations.estimatedAdjustments.count, 2);
  assert.equal(snapshot.obligations.estimatedAdjustments.amount, 857000);
  assert.equal(snapshot.obligations.unconfirmed.count, 2);
  assert.equal(snapshot.obligations.unconfirmed.amount, 500000);
  assert.deepEqual(snapshot.obligations.unconfirmed.objectIds, ['ADMIN-2026-08', 'TAX-RESERVE']);
});

test('exact obligation estimate is treated as unconfirmed financial risk', () => {
  const snapshot = buildDecisionFinancialSnapshot({
    asOfDate: '2026-09-05',
    obligationRows: [
      { id: 'ADMIN-2026-08', dueDate: '2026-09-05', remaining: 500000, priority: 'Критический', status: 'Оценка' }
    ]
  });

  assert.equal(snapshot.obligations.unconfirmed.count, 1);
  assert.equal(snapshot.obligations.unconfirmed.amount, 500000);
  assert.deepEqual(snapshot.obligations.unconfirmed.objectIds, ['ADMIN-2026-08']);
});

test('shadow comparison reports a precise mismatch instead of silently accepting drift', () => {
  const snapshot = buildDecisionFinancialSnapshot({
    asOfDate: '2026-08-31',
    cashGapAmount: 0,
    adjustmentRows: [],
    obligationRows: []
  });
  const catalog = [{ ruleId: 'DEC-CASH-GAP', evaluatorKey: 'cash_gap_30d', enabled: true, version: 1 }];
  const currentDecisions = [{ ruleId: 'DEC-CASH-GAP', active: true, amount: 100, dueDate: '2026-09-01', linkedObjects: [] }];

  const comparison = compareDecisionShadow({ catalog, snapshot, currentDecisions, now });

  assert.equal(comparison.matches, 0);
  assert.equal(comparison.mismatches.length, 1);
  assert.equal(comparison.mismatches[0].ruleId, 'DEC-CASH-GAP');
  assert.ok(comparison.mismatches[0].fields.includes('active'));
});
