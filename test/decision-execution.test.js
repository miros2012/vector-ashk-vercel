import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDecisionAction } from '../lib/decision-execution.js';

const now = new Date('2026-08-31T15:56:00.000Z');

function current(overrides = {}) {
  return {
    ruleId: 'DEC-CRIT-DUE',
    executionStatus: 'Не начато',
    verificationStatus: 'Не проверено',
    plannedEffect: 1179607.47,
    actualEffect: null,
    startedAt: null,
    completedAt: null,
    result: '',
    lastCheckedAt: null,
    ...overrides
  };
}

test('start moves an active decision into work and creates history event', () => {
  const out = applyDecisionAction(current(), {
    action: 'start',
    actor: 'Ответственный за финансы'
  }, now);

  assert.equal(out.next.executionStatus, 'В работе');
  assert.equal(out.next.startedAt, now.toISOString());
  assert.equal(out.event.type, 'Взято в работу');
  assert.equal(out.event.before, 'Не начато');
  assert.equal(out.event.after, 'В работе');
});

test('complete requires decision to be in work and records result', () => {
  const out = applyDecisionAction(current({
    executionStatus: 'В работе',
    startedAt: '2026-08-31T15:40:00.000Z'
  }), {
    action: 'complete',
    actor: 'Ответственный за финансы',
    result: 'Платёж подготовлен'
  }, now);

  assert.equal(out.next.executionStatus, 'Готово');
  assert.equal(out.next.completedAt, now.toISOString());
  assert.equal(out.next.result, 'Платёж подготовлен');
  assert.equal(out.event.type, 'Завершено');
});

test('verify preserves execution status and stores confirmed financial effect', () => {
  const out = applyDecisionAction(current({
    executionStatus: 'Готово',
    startedAt: '2026-08-31T15:40:00.000Z',
    completedAt: '2026-08-31T15:50:00.000Z'
  }), {
    action: 'verify',
    actor: 'AI/финконтроль',
    verificationStatus: 'Подтверждено',
    actualEffect: 1179607.47,
    evidence: 'Банковская операция'
  }, now);

  assert.equal(out.next.executionStatus, 'Готово');
  assert.equal(out.next.verificationStatus, 'Подтверждено');
  assert.equal(out.next.actualEffect, 1179607.47);
  assert.equal(out.next.lastCheckedAt, now.toISOString());
  assert.equal(out.event.type, 'Проверено');
  assert.equal(out.event.actualEffect, 1179607.47);
});

test('invalid transition is rejected', () => {
  assert.throws(() => applyDecisionAction(current(), {
    action: 'complete',
    actor: 'Ответственный за финансы'
  }, now), /complete requires execution status В работе/);
});
