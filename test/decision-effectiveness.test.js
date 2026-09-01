import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDecisionEffectiveness } from '../lib/decision-effectiveness.js';

const decisions = [
  { ruleId:'A', executionStatus:'Готово', verificationStatus:'Подтверждено', plannedEffect:100, actualEffect:80 },
  { ruleId:'B', executionStatus:'Готово', verificationStatus:'Нет эффекта', plannedEffect:200, actualEffect:null },
  { ruleId:'C', executionStatus:'В работе', verificationStatus:'Не проверено', plannedEffect:300, actualEffect:null },
  { ruleId:'D', executionStatus:'Не начато', verificationStatus:'Не проверено', plannedEffect:400, actualEffect:null }
];

const history = [
  { eventId:'a0', ruleId:'A', type:'Инициализация', at:'2026-09-01T08:00:00Z' },
  { eventId:'a1', ruleId:'A', type:'Взято в работу', at:'2026-09-01T09:00:00Z' },
  { eventId:'a2', ruleId:'A', type:'Завершено', at:'2026-09-01T11:00:00Z' },
  { eventId:'a3', ruleId:'A', type:'Проверено', at:'2026-09-01T12:00:00Z', verificationStatus:'Подтверждено', actualEffect:80, plannedEffect:100 },
  { eventId:'b0', ruleId:'B', type:'Инициализация', at:'2026-09-01T08:00:00Z' },
  { eventId:'b1', ruleId:'B', type:'Взято в работу', at:'2026-09-01T10:00:00Z' },
  { eventId:'b2', ruleId:'B', type:'Завершено', at:'2026-09-01T14:00:00Z' },
  { eventId:'b3', ruleId:'B', type:'Проверено', at:'2026-09-01T16:00:00Z', verificationStatus:'Нет эффекта', actualEffect:null, plannedEffect:200 },
  { eventId:'c0', ruleId:'C', type:'Инициализация', at:'2026-09-01T08:00:00Z' },
  { eventId:'c1', ruleId:'C', type:'Взято в работу', at:'2026-09-01T11:00:00Z' },
  { eventId:'c1', ruleId:'C', type:'Взято в работу', at:'2026-09-01T11:00:00Z' },
  { eventId:'bad', ruleId:'C', type:'Проверено', at:'not-a-date' }
];

test('calculates execution funnel, realized effect and lifecycle timing from immutable history', () => {
  const result = calculateDecisionEffectiveness({ decisions, history });
  assert.equal(result.recommendationCount, 4);
  assert.equal(result.startedCount, 3);
  assert.equal(result.completedCount, 2);
  assert.equal(result.verifiedCount, 2);
  assert.equal(result.confirmedEffectCount, 1);
  assert.equal(result.totalConfirmedEffect, 80);
  assert.equal(result.startRate, 0.75);
  assert.equal(result.completionRate, 0.5);
  assert.equal(result.verificationRate, 0.5);
  assert.equal(result.averageTimeToStartHours, 2);
  assert.equal(result.averageTimeToCompleteHours, 3);
  assert.equal(result.averageTimeToVerifyHours, 1.5);
  assert.equal(result.effectRealizationRatio, 0.8);
});

test('returns null timing and realization metrics when no comparable data exists', () => {
  const result = calculateDecisionEffectiveness({
    decisions:[{ ruleId:'X', executionStatus:'Не начато', verificationStatus:'Не проверено', plannedEffect:0 }],
    history:[]
  });
  assert.equal(result.averageTimeToStartHours, null);
  assert.equal(result.averageTimeToCompleteHours, null);
  assert.equal(result.averageTimeToVerifyHours, null);
  assert.equal(result.effectRealizationRatio, null);
});
