import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerActionView } from '../lib/owner-action-view.js';

function decision(overrides = {}) {
  return {
    ruleId: 'DEC-A',
    title: 'Событие',
    deviation: 'Отклонение',
    recommendation: 'Решение',
    task: 'Задача',
    assignee: 'Собственник',
    deadline: '2026-09-03',
    priority: 'Критический',
    ruleStatus: 'Активно',
    executionStatus: 'Не начато',
    verificationStatus: 'Не проверено',
    plannedEffect: 100000,
    actualEffect: null,
    linkedObject: 'OBJ-1',
    lastResult: '',
    lastChecked: null,
    rank: 1,
    _row: 2,
    ...overrides
  };
}

test('selects highest ranked active decision and exposes only UI fields', () => {
  const view = buildOwnerActionView([
    decision({ ruleId: 'DEC-B', rank: 2 }),
    decision({ ruleId: 'DEC-A', rank: 1 }),
    decision({ ruleId: 'DEC-X', rank: 0, ruleStatus: 'Неактивно' })
  ]);

  assert.equal(view.activeCount, 2);
  assert.equal(view.top.ruleId, 'DEC-A');
  assert.deepEqual(view.top.allowedActions, ['start']);
  assert.equal('rank' in view.top, false);
  assert.equal('_row' in view.top, false);
  assert.equal('ruleStatus' in view.top, false);
});

test('allowed actions follow execution lifecycle', () => {
  assert.deepEqual(
    buildOwnerActionView([decision({ executionStatus: 'В работе' })]).top.allowedActions,
    ['complete']
  );
  assert.deepEqual(
    buildOwnerActionView([decision({ executionStatus: 'Готово', verificationStatus: 'Не проверено' })]).top.allowedActions,
    ['verify_confirmed', 'verify_no_effect', 'verify_na']
  );
  assert.deepEqual(
    buildOwnerActionView([decision({ executionStatus: 'Готово', verificationStatus: 'Подтверждено' })]).top.allowedActions,
    []
  );
});

test('uses deadline then ruleId as deterministic tie breakers', () => {
  const view = buildOwnerActionView([
    decision({ ruleId: 'DEC-B', rank: 1, deadline: '2026-09-04' }),
    decision({ ruleId: 'DEC-C', rank: 1, deadline: '2026-09-03' }),
    decision({ ruleId: 'DEC-A', rank: 1, deadline: '2026-09-03' })
  ]);
  assert.equal(view.top.ruleId, 'DEC-A');
});

test('returns null top when no active decisions exist', () => {
  const view = buildOwnerActionView([decision({ ruleStatus: 'Неактивно' })]);
  assert.deepEqual(view, { top: null, activeCount: 0 });
});
