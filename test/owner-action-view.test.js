import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerActionView } from '../lib/owner-action-view.js';

function decision(overrides = {}) {
  return {
    ruleId:'DEC-A', title:'Событие', deviation:'Причина', recommendation:'Решение', task:'Задача', assignee:'Собственник',
    deadline:'2026-09-02', priority:'Высокий', ruleStatus:'Активно', executionStatus:'Не начато', verificationStatus:'Не проверено',
    plannedEffect:1000, actualEffect:null, linkedObject:'OBJ-1', rank:2, lastResult:'', lastChecked:null,
    ...overrides
  };
}

test('selects lowest rank active decision and exposes start action', () => {
  const view = buildOwnerActionView([
    decision({ ruleId:'DEC-A', rank:2 }),
    decision({ ruleId:'DEC-B', rank:1, priority:'Критический' }),
    decision({ ruleId:'DEC-X', rank:0, ruleStatus:'Неактивно' })
  ]);
  assert.equal(view.activeCount, 2);
  assert.equal(view.top.ruleId, 'DEC-B');
  assert.deepEqual(view.top.allowedActions, ['start']);
  assert.equal('rank' in view.top, false);
  assert.equal('_row' in view.top, false);
});

test('maps execution lifecycle to context-sensitive allowed actions', () => {
  assert.deepEqual(buildOwnerActionView([decision({ executionStatus:'В работе' })]).top.allowedActions, ['complete']);
  assert.deepEqual(buildOwnerActionView([decision({ executionStatus:'Готово', verificationStatus:'Не проверено' })]).top.allowedActions,
    ['verify_confirmed','verify_no_effect','verify_na']);
  assert.deepEqual(buildOwnerActionView([decision({ executionStatus:'Готово', verificationStatus:'Подтверждено' })]).top.allowedActions, []);
});

test('returns null top when no active decisions exist', () => {
  const view = buildOwnerActionView([decision({ ruleStatus:'Неактивно' })]);
  assert.equal(view.activeCount, 0);
  assert.equal(view.top, null);
});
