import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionVerificationQueue } from '../lib/decision-verification-queue.js';

const NOW = '2026-09-06T12:00:00.000Z';

function decision(overrides = {}) {
  return {
    ruleId: 'decision-1',
    executionStatus: 'Готово',
    verificationStatus: 'Не проверено',
    plannedEffect: 1000,
    responsible: 'Owner',
    completedAt: '2026-09-05T12:00:00.000Z',
    synthetic: false,
    ...overrides
  };
}

function completedEvent(overrides = {}) {
  return {
    eventId: 'event-1',
    ruleId: 'decision-1',
    type: 'Завершено',
    at: '2026-09-05T12:00:00.000Z',
    ...overrides
  };
}

function build(decisions, history = [], overrides = {}) {
  return buildDecisionVerificationQueue({
    decisions,
    history,
    now: NOW,
    verificationSlaHours: 24,
    ...overrides
  });
}

test('returns only completed real decisions that still need verification', () => {
  const result = build([
    decision({ ruleId: 'unverified' }),
    decision({ ruleId: 'blank-status', verificationStatus: '   ' }),
    decision({ ruleId: 'verified', verificationStatus: 'Подтверждено' }),
    decision({ ruleId: 'working', executionStatus: 'В работе' }),
    decision({ ruleId: 'synthetic', synthetic: true })
  ]);

  assert.equal(result.total, 2);
  assert.deepEqual(result.items.map(item => item.ruleId), ['blank-status', 'unverified']);
  assert.deepEqual(result.items.map(item => item.priorityRank), [1, 2]);
});

test('uses the earliest deduplicated completion event before decision completedAt', () => {
  const result = build([
    decision({ completedAt: '2026-09-05T11:00:00.000Z' })
  ], [
    completedEvent({ eventId: 'late', at: '2026-09-05T10:00:00.000Z' }),
    completedEvent({ eventId: 'early', at: '2026-09-05T08:00:00.000Z' }),
    completedEvent({ eventId: 'early', at: '2026-09-05T08:00:00.000Z' }),
    completedEvent({ eventId: 'other-type', type: 'Взято в работу', at: '2026-09-04T08:00:00.000Z' })
  ]);

  assert.equal(result.items[0].completionTimestamp, '2026-09-05T08:00:00.000Z');
  assert.equal(result.items[0].hoursWaiting, 28);
  assert.equal(result.items[0].hoursOverdue, 4);
  assert.equal(result.historyEventCount, 3);
});

test('falls back to decision completedAt when no valid completion event exists', () => {
  const result = build([
    decision({ completedAt: '2026-09-06T10:30:00+05:00' })
  ], [
    completedEvent({ eventId: 'start', type: 'Взято в работу' })
  ]);

  assert.equal(result.items[0].completionTimestamp, '2026-09-06T05:30:00.000Z');
  assert.equal(result.items[0].hoursWaiting, 6.5);
});

test('sorts overdue first, then effect, oldest completion and stable rule id', () => {
  const result = build([
    decision({
      ruleId: 'future-large',
      plannedEffect: 999999,
      completedAt: '2026-09-06T00:00:00.000Z'
    }),
    decision({
      ruleId: 'b',
      plannedEffect: 500,
      completedAt: '2026-09-05T00:00:00.000Z'
    }),
    decision({
      ruleId: 'oldest',
      plannedEffect: 500,
      completedAt: '2026-09-04T23:00:00.000Z'
    }),
    decision({
      ruleId: 'a',
      plannedEffect: 500,
      completedAt: '2026-09-05T00:00:00.000Z'
    }),
    decision({
      ruleId: 'smaller',
      plannedEffect: 100,
      completedAt: '2026-09-04T00:00:00.000Z'
    })
  ]);

  assert.deepEqual(result.items.map(item => item.ruleId), [
    'oldest',
    'a',
    'b',
    'smaller',
    'future-large'
  ]);
  assert.deepEqual(result.items.map(item => item.priorityRank), [1, 2, 3, 4, 5]);
  assert.equal(result.overdueCount, 4);
});

test('treats the exact SLA boundary as not overdue', () => {
  const result = build([decision()]);

  assert.equal(result.items[0].hoursWaiting, 24);
  assert.equal(result.items[0].overdue, false);
  assert.equal(result.items[0].hoursOverdue, 0);
});

test('normalizes supplied now, SLA, planned effect and optional responsible actor', () => {
  const result = build([
    decision({ plannedEffect: -0, responsible: '   ' })
  ], [], {
    now: '2026-09-06T17:00:00+05:00',
    verificationSlaHours: -0
  });

  assert.equal(result.now, NOW);
  assert.equal(result.verificationSlaHours, 0);
  assert.equal(Object.is(result.items[0].plannedEffect, -0), false);
  assert.equal(result.items[0].plannedEffect, 0);
  assert.equal(result.items[0].responsible, null);
  assert.equal(result.items[0].overdue, true);
});

test('allows signed finite planned effects without inventing an absolute value', () => {
  const result = build([
    decision({ ruleId: 'negative', plannedEffect: -50 }),
    decision({ ruleId: 'positive', plannedEffect: 10 })
  ]);

  assert.deepEqual(result.items.map(item => item.ruleId), ['positive', 'negative']);
  assert.equal(result.items[1].plannedEffect, -50);
});

test('synthetic decisions and all history tied to them never affect the queue', () => {
  const result = build([
    decision({ ruleId: 'real' }),
    decision({ ruleId: 'synthetic', synthetic: true, completedAt: 'not-a-time', plannedEffect: Number.NaN })
  ], [
    completedEvent({ eventId: 'synthetic-complete', ruleId: 'synthetic', at: 'not-a-time' }),
    completedEvent({ eventId: 'real-complete', ruleId: 'real', at: '2026-09-05T10:00:00.000Z' })
  ]);

  assert.deepEqual(result.items.map(item => item.ruleId), ['real']);
  assert.equal(result.historyEventCount, 1);
});

test('fails closed for duplicate real rule ids but ignores a synthetic duplicate', () => {
  assert.throws(() => build([
    decision({ ruleId: 'same' }),
    decision({ ruleId: ' same ', executionStatus: 'В работе' })
  ]), /duplicate real ruleId: same/i);

  const result = build([
    decision({ ruleId: 'same' }),
    decision({ ruleId: 'same', synthetic: true })
  ]);
  assert.equal(result.total, 1);
});

test('fails closed for malformed or future completion timestamps of eligible decisions', () => {
  assert.throws(() => build([
    decision({ completedAt: '2026-02-30T12:00:00.000Z' })
  ]), /completion timestamp.*decision-1.*invalid/i);

  assert.throws(() => build([
    decision()
  ], [
    completedEvent({ at: 'not-a-time' })
  ]), /completion timestamp.*decision-1.*invalid/i);

  assert.throws(() => build([
    decision({ completedAt: '2026-09-06T12:00:00.001Z' })
  ]), /completion timestamp.*after now/i);
});

test('fails closed for invalid now and verification SLA', () => {
  assert.throws(() => build([], [], { now: 'not-a-time' }), /now.*invalid/i);
  assert.throws(() => build([], [], { now: '2026-02-30T12:00:00.000Z' }), /now.*invalid/i);

  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, '24']) {
    assert.throws(
      () => build([], [], { verificationSlaHours: value }),
      /verificationSlaHours.*(?:finite|non-negative)/i
    );
  }
});

test('fails closed for missing real ids and non-finite eligible planned effects', () => {
  assert.throws(() => build([
    decision({ ruleId: '   ' })
  ]), /ruleId.*required/i);

  for (const plannedEffect of [Number.NaN, Number.POSITIVE_INFINITY, '100']) {
    assert.throws(
      () => build([decision({ plannedEffect })]),
      /plannedEffect.*finite/i
    );
  }
});

test('does not mutate inputs and returns a deeply immutable queue', () => {
  const decisions = [decision()];
  const history = [completedEvent()];
  const source = {
    decisions,
    history,
    now: NOW,
    verificationSlaHours: 24
  };
  const before = structuredClone(source);

  const result = buildDecisionVerificationQueue(source);

  assert.deepEqual(source, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.items), true);
  assert.equal(Object.isFrozen(result.items[0]), true);
  assert.throws(() => { result.total = 0; }, TypeError);
  assert.throws(() => { result.items[0].priorityRank = 99; }, TypeError);
  assert.throws(() => { result.items.push({}); }, TypeError);
});

test('fails closed for invalid top-level collections', () => {
  assert.throws(() => buildDecisionVerificationQueue(), /input.*required/i);
  assert.throws(() => buildDecisionVerificationQueue({
    decisions: {},
    history: [],
    now: NOW,
    verificationSlaHours: 24
  }), /decisions.*array/i);
  assert.throws(() => buildDecisionVerificationQueue({
    decisions: [],
    history: {},
    now: NOW,
    verificationSlaHours: 24
  }), /history.*array/i);
});
