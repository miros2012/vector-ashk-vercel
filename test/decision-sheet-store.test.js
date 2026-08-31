import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decisionFromSheetRow,
  buildDecisionUpdates,
  buildHistoryRow
} from '../lib/decision-sheet-store.js';

test('maps Решения A:V into generic execution state', () => {
  const row = Array(22).fill('');
  row[0] = 'DEC-CRIT-DUE';
  row[9] = 'Активно';
  row[10] = 'В работе';
  row[12] = 1179607.47;
  row[13] = 100000;
  row[17] = '31.08.2026';
  row[18] = '';
  row[19] = 'Подготовлен платёж';
  row[20] = 'Не проверено';
  row[21] = '';

  const state = decisionFromSheetRow(row, 5);

  assert.equal(state.ruleId, 'DEC-CRIT-DUE');
  assert.equal(state.ruleStatus, 'Активно');
  assert.equal(state.executionStatus, 'В работе');
  assert.equal(state.plannedEffect, 1179607.47);
  assert.equal(state.actualEffect, 100000);
  assert.equal(state._row, 5);
});

test('builds exact write ranges for execution state without touching financial rule formulas', () => {
  const updates = buildDecisionUpdates(5, {
    executionStatus: 'Готово',
    actualEffect: 1179607.47,
    startedAt: '2026-08-31T15:40:00.000Z',
    completedAt: '2026-08-31T15:56:00.000Z',
    result: 'Платёж подготовлен',
    verificationStatus: 'Не проверено',
    lastCheckedAt: null
  });

  assert.deepEqual(updates, [
    { range: "'Решения'!K5", values: [['Готово']] },
    { range: "'Решения'!N5", values: [[1179607.47]] },
    { range: "'Решения'!R5:V5", values: [['2026-08-31T15:40:00.000Z', '2026-08-31T15:56:00.000Z', 'Платёж подготовлен', 'Не проверено', '']] }
  ]);
});

test('builds append-only history row in the agreed A:K schema', () => {
  const row = buildHistoryRow({
    ruleId: 'DEC-CRIT-DUE',
    type: 'Проверено',
    at: '2026-08-31T15:56:00.000Z',
    before: 'Готово',
    after: 'Готово',
    actor: 'AI/финконтроль',
    plannedEffect: 1179607.47,
    actualEffect: 1179607.47,
    evidence: 'Банковская операция',
    comment: 'Платёж подтверждён'
  }, 'EVT-123');

  assert.deepEqual(row, [
    'EVT-123', 'DEC-CRIT-DUE', 'Проверено', '2026-08-31T15:56:00.000Z',
    'Готово', 'Готово', 'AI/финконтроль', 1179607.47, 1179607.47,
    'Банковская операция', 'Платёж подтверждён'
  ]);
});
