import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDecisionEffectiveness } from '../lib/decision-effectiveness.js';

test('calculates execution funnel, durations and confirmed financial effect', () => {
  const decisions = [
    { ruleId:'A', plannedEffect:1000, executionStatus:'Готово', verificationStatus:'Подтверждено', actualEffect:800 },
    { ruleId:'B', plannedEffect:500, executionStatus:'В работе', verificationStatus:'Не проверено', actualEffect:null }
  ];
  const history = [
    { eventId:'a0', ruleId:'A', type:'Инициализация', at:'2026-09-01T08:00:00Z' },
    { eventId:'a1', ruleId:'A', type:'Взято в работу', at:'2026-09-01T09:00:00Z' },
    { eventId:'a2', ruleId:'A', type:'Завершено', at:'2026-09-01T11:00:00Z' },
    { eventId:'a3', ruleId:'A', type:'Проверено', at:'2026-09-01T12:00:00Z', actualEffect:800, verificationStatus:'Подтверждено' },
    { eventId:'b0', ruleId:'B', type:'Инициализация', at:'2026-09-01T08:00:00Z' },
    { eventId:'b1', ruleId:'B', type:'Взято в работу', at:'2026-09-01T10:00:00Z' },
    { eventId:'b1', ruleId:'B', type:'Взято в работу', at:'2026-09-01T10:00:00Z' }
  ];
  const m = calculateDecisionEffectiveness({ decisions, history });
  assert.equal(m.recommendationCount, 2);
  assert.equal(m.startedCount, 2);
  assert.equal(m.completedCount, 1);
  assert.equal(m.verifiedCount, 1);
  assert.equal(m.confirmedEffectCount, 1);
  assert.equal(m.totalConfirmedEffect, 800);
  assert.equal(m.startRate, 1);
  assert.equal(m.completionRate, 0.5);
  assert.equal(m.verificationRate, 0.5);
  assert.equal(m.averageTimeToStartHours, 1.5);
  assert.equal(m.averageTimeToCompleteHours, 2);
  assert.equal(m.averageTimeToVerifyHours, 1);
  assert.equal(m.effectRealizationRatio, 0.8);
});

test('returns zero-safe metrics for empty data', () => {
  const m = calculateDecisionEffectiveness({ decisions:[], history:[] });
  assert.equal(m.recommendationCount, 0);
  assert.equal(m.startRate, 0);
  assert.equal(m.totalConfirmedEffect, 0);
  assert.equal(m.effectRealizationRatio, null);
});
