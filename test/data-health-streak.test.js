import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataHealthStreak } from '../lib/data-health-streak.js';

function records() {
  return [
    { businessDate: '2026-09-01', status: 'OK' },
    { businessDate: '2026-09-02', status: 'WARNING', reasons: [' hours late ', 'cash review', 'cash review'] },
    { businessDate: '2026-09-03', status: 'OK' },
    { businessDate: '2026-09-04', status: 'OK' },
    { businessDate: '2026-09-05', status: 'OK' }
  ];
}

test('calculates current and longest healthy streaks and threshold boundary', () => {
  const result = buildDataHealthStreak({ records: records(), asOfDate: '2026-09-05', requiredHealthyStreak: 3 });
  assert.equal(result.currentStreak, 3);
  assert.equal(result.longestStreak, 3);
  assert.equal(result.thresholdReached, true);
  assert.equal(result.lastUnhealthyDate, '2026-09-02');
  assert.deepEqual(result.lastUnhealthyReasons, ['cash review', 'hours late']);
  assert.deepEqual(result.missingDates, []);
});

test('gaps are reported and break streaks', () => {
  const result = buildDataHealthStreak({
    records: [
      { businessDate: '2026-09-01', status: 'OK' },
      { businessDate: '2026-09-03', status: 'OK' },
      { businessDate: '2026-09-04', status: 'OK' }
    ],
    asOfDate: '2026-09-04',
    requiredHealthyStreak: 2
  });
  assert.equal(result.currentStreak, 2);
  assert.equal(result.longestStreak, 2);
  assert.deepEqual(result.missingDates, ['2026-09-02']);
});

test('missing as-of day breaks the current streak', () => {
  const result = buildDataHealthStreak({ records: records(), asOfDate: '2026-09-06', requiredHealthyStreak: 1 });
  assert.equal(result.currentStreak, 0);
  assert.equal(result.longestStreak, 3);
  assert.equal(result.thresholdReached, false);
});

test('BLOCKED and WARNING are unhealthy and latest unhealthy reasons are deterministic', () => {
  const result = buildDataHealthStreak({
    records: [
      { businessDate: '2026-09-01', status: 'blocked', reasons: ['z', 'a'] },
      { businessDate: '2026-09-02', status: 'ok' },
      { businessDate: '2026-09-03', status: ' warning ', reasons: [' beta ', 'alpha', 'beta'] }
    ],
    asOfDate: '2026-09-03',
    requiredHealthyStreak: 1
  });
  assert.equal(result.currentStreak, 0);
  assert.equal(result.longestStreak, 1);
  assert.equal(result.lastUnhealthyDate, '2026-09-03');
  assert.deepEqual(result.lastUnhealthyReasons, ['alpha', 'beta']);
});

test('future records are explicitly reported and do not affect historical streaks', () => {
  const result = buildDataHealthStreak({
    records: [...records(), { businessDate: '2026-09-07', status: 'OK' }],
    asOfDate: '2026-09-05',
    requiredHealthyStreak: 3
  });
  assert.deepEqual(result.futureDates, ['2026-09-07']);
  assert.equal(result.currentStreak, 3);
  assert.equal(result.longestStreak, 3);
});

test('normalizes records in date order and returns deeply immutable output without mutating input', () => {
  const input = {
    records: [
      { businessDate: '2026-09-02', status: 'warning', reasons: [' b ', 'a', 'a'] },
      { businessDate: '2026-09-01', status: 'ok' }
    ],
    asOfDate: '2026-09-02',
    requiredHealthyStreak: 2
  };
  const before = structuredClone(input);
  const result = buildDataHealthStreak(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result.records, [
    { businessDate: '2026-09-01', status: 'OK', reasons: [] },
    { businessDate: '2026-09-02', status: 'WARNING', reasons: ['a', 'b'] }
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.records), true);
  assert.equal(Object.isFrozen(result.records[0]), true);
  assert.throws(() => result.records.push({}), TypeError);
});

test('rejects duplicate dates, malformed dates, unsupported statuses and invalid thresholds', () => {
  assert.throws(() => buildDataHealthStreak({ records: [
    { businessDate: '2026-09-01', status: 'OK' },
    { businessDate: '2026-09-01', status: 'OK' }
  ], asOfDate: '2026-09-01', requiredHealthyStreak: 1 }), /duplicate businessDate/);
  assert.throws(() => buildDataHealthStreak({ records: [{ businessDate: '2026-02-30', status: 'OK' }], asOfDate: '2026-03-01', requiredHealthyStreak: 1 }), /valid YYYY-MM-DD/);
  assert.throws(() => buildDataHealthStreak({ records: [{ businessDate: '2026-09-01', status: 'GREEN' }], asOfDate: '2026-09-01', requiredHealthyStreak: 1 }), /unsupported Data Health status/);
  for (const threshold of [0, -1, 1.5, NaN, Infinity, '3']) {
    assert.throws(() => buildDataHealthStreak({ records: records(), asOfDate: '2026-09-05', requiredHealthyStreak: threshold }), /positive integer/);
  }
});

test('rejects malformed as-of dates, future-only and empty datasets, and ambiguous reasons', () => {
  assert.throws(() => buildDataHealthStreak({ records: records(), asOfDate: '2026-13-01', requiredHealthyStreak: 1 }), /valid YYYY-MM-DD/);
  assert.throws(() => buildDataHealthStreak({ records: [{ businessDate: '2026-09-07', status: 'OK' }], asOfDate: '2026-09-06', requiredHealthyStreak: 1 }), /on or before asOfDate/);
  assert.throws(() => buildDataHealthStreak({ records: [], asOfDate: '2026-09-06', requiredHealthyStreak: 1 }), /at least one record/);
  assert.throws(() => buildDataHealthStreak({ records: [{ businessDate: '2026-09-06', status: 'OK', reasons: 'none' }], asOfDate: '2026-09-06', requiredHealthyStreak: 1 }), /reasons must be an array/);
  assert.throws(() => buildDataHealthStreak({ records: [{ businessDate: '2026-09-06', status: 'OK', reasons: [' '] }], asOfDate: '2026-09-06', requiredHealthyStreak: 1 }), /reason must be non-empty/);
});
