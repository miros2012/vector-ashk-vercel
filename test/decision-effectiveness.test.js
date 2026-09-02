import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDecisionEffectiveness } from '../lib/decision-effectiveness.js';

const decisions = [
  { ruleId:'A', executionStatus:'Готово', verificationStatus:'Подтверждено', plannedEffect:100, actualEffect:80 },
  { ruleId:'B', executionStatus:'Готово', verificationStatus:'Нет эффекта', plannedEffect:200, actualEffect:null },
  { ruleId:'C', executionStatus:'В работе', verificationStatus:'Не проверено', plannedEffect:300, actualEffect:null }
];

const history = [
  { eventId:'A0', ruleId:'A', type:'Инициализация', at:'2026-09-01T10:00:00Z' },
  { eventId:'A1', ruleId:'A', type:'Взято в работу', at:'2026-09-01T12:00:00Z' },
  { eventId:'A2', ruleId:'A', type:'Завершено', at:'2026-09-01T14:00:00Z' },
  { eventId:'A3', ruleId:'A', type:'Проверено', at:'2026-09-01T15:00:00Z', actualEffect:80 },
  { eventId:'A3', ruleId:'A', type:'Проверено', at:'2026-09-01T15:00:00Z', actualEffect:80 },
  { eventId:'B0', ruleId:'B', type:'Инициализация', at:'2026-09-01T10:00:00Z' },
  { eventId:'B1', ruleId:'B', type:'Взято в работу', at:'2026-09-01T13:00:00Z' },
  { eventId:'B2', ruleId:'B', type:'Завершено', at:'2026-09-01T16:00:00Z' },
  { eventId:'B3', ruleId:'B', type:'Проверено', at:'2026-09-01T17:00:00Z' },
  { eventId:'C0', ruleId:'C', type:'Инициализация', at:'2026-09-01T10:00:00Z' },
  { eventId:'C1', ruleId:'C', type:'Взято в работу', at:'2026-09-01T11:00:00Z' }
];

test('calculates execution funnel, realized value and lifecycle timing', () => {
  const metrics = calculateDecisionEffectiveness({ decisions, history });

  assert.equal(metrics.recommendationCount, 3);
  assert.equal(metrics.startedCount, 3);
  assert.equal(metrics.completedCount, 2);
  assert.equal(metrics.verifiedCount, 2);
  assert.equal(metrics.confirmedEffectCount, 1);
  assert.equal(metrics.totalConfirmedEffect, 80);
  assert.equal(metrics.startRate, 1);
  assert.equal(metrics.completionRate, 2/3);
  assert.equal(metrics.verificationRate, 1);
  assert.equal(metrics.averageTimeToStartHours, 2);
  assert.equal(metrics.averageTimeToCompleteHours, 2.5);
  assert.equal(metrics.averageTimeToVerifyHours, 1);
  assert.equal(metrics.effectRealizationRatio, 0.8);
  assert.equal(metrics.historyEventCount, 10);
});

test('zero denominators and absent timing return safe values', () => {
  const metrics = calculateDecisionEffectiveness({ decisions: [], history: [] });
  assert.deepEqual(metrics, {
    recommendationCount: 0,
    startedCount: 0,
    completedCount: 0,
    verifiedCount: 0,
    confirmedEffectCount: 0,
    totalConfirmedEffect: 0,
    startRate: 0,
    completionRate: 0,
    verificationRate: 0,
    averageTimeToStartHours: null,
    averageTimeToCompleteHours: null,
    averageTimeToVerifyHours: null,
    effectRealizationRatio: null,
    historyEventCount: 0
  });
});

test('does not invent time-to-start when first event is already start', () => {
  const metrics = calculateDecisionEffectiveness({
    decisions: [{ ruleId:'X', executionStatus:'В работе', verificationStatus:'Не проверено', plannedEffect:10, actualEffect:null }],
    history: [{ eventId:'X1', ruleId:'X', type:'Взято в работу', at:'2026-09-01T12:00:00Z' }]
  });
  assert.equal(metrics.averageTimeToStartHours, null);
});
