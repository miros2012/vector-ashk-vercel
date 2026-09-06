import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createForecastSnapshot,
  verifyForecastSnapshot
} from '../lib/forecast-snapshot-journal.js';

function input(overrides = {}) {
  return {
    snapshotId: ' forecast-2026-09-06T15 ',
    generatedAt: '2026-09-06T15:10:20+05:00',
    modelVersion: ' cash-forecast-v1 ',
    forecastStartDate: '2026-09-07',
    forecastEndDate: '2026-09-09',
    scenarios: [
      {
        name: ' target ',
        minimumBalance: 250000,
        minimumBalanceDate: '2026-09-08',
        cashGap: 0,
        requiredCollection: 0,
        safeWithdrawal: 150000
      },
      {
        name: ' conservative ',
        minimumBalance: -100000,
        minimumBalanceDate: '2026-09-09',
        cashGap: 100000,
        requiredCollection: 200000,
        safeWithdrawal: 0
      },
      {
        name: ' base ',
        minimumBalance: 100000,
        minimumBalanceDate: '2026-09-07',
        cashGap: 0,
        requiredCollection: 0,
        safeWithdrawal: 0
      }
    ],
    ...overrides
  };
}

function inputWithDaily(overrides = {}) {
  const source = input();
  const dailyByScenario = {
    target: [
      { date: '2026-09-09', closingBalance: 300000 },
      { date: '2026-09-07', closingBalance: 350000 },
      { date: '2026-09-08', closingBalance: 250000 }
    ],
    conservative: [
      { date: '2026-09-08', closingBalance: -50000 },
      { date: '2026-09-09', closingBalance: -100000 },
      { date: '2026-09-07', closingBalance: 0 }
    ],
    base: [
      { date: '2026-09-09', closingBalance: 120000 },
      { date: '2026-09-07', closingBalance: 100000 },
      { date: '2026-09-08', closingBalance: 110000 }
    ]
  };

  source.scenarios = source.scenarios.map(scenario => ({
    ...scenario,
    daily: dailyByScenario[scenario.name.trim()]
  }));

  return { ...source, ...overrides };
}

test('normalizes a forecast snapshot and fingerprints only normalized business fields', () => {
  const result = createForecastSnapshot(input());

  assert.equal(result.snapshotId, 'forecast-2026-09-06T15');
  assert.equal(result.generatedAt, '2026-09-06T10:10:20.000Z');
  assert.equal(result.modelVersion, 'cash-forecast-v1');
  assert.equal(result.forecastStartDate, '2026-09-07');
  assert.equal(result.forecastEndDate, '2026-09-09');
  assert.deepEqual(result.scenarios.map(scenario => scenario.name), [
    'base',
    'conservative',
    'target'
  ]);
  assert.equal(result.scenarios[1].minimumBalance, -100000);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(verifyForecastSnapshot(result), true);
});

test('keeps aggregate-only snapshot fingerprint semantics backward compatible', () => {
  const result = createForecastSnapshot(input());

  assert.equal(
    result.fingerprint,
    'ad7a75be42d9b414c52f5fc8b4ed3a58dcecfe5b6d599eae7bb0b5f1f879319a'
  );
  assert.equal(result.scenarios.some(scenario => 'daily' in scenario), false);
  assert.equal(verifyForecastSnapshot(result), true);
});

test('is order independent for scenario summaries and equivalent timestamps', () => {
  const first = createForecastSnapshot(input());
  const source = input();
  const second = createForecastSnapshot(input({
    generatedAt: '2026-09-06T10:10:20Z',
    scenarios: [...source.scenarios].reverse()
  }));

  assert.deepEqual(first, second);
  assert.equal(first.fingerprint, second.fingerprint);
});

test('normalizes, sorts and fingerprints optional scenario daily balances deterministically', () => {
  const first = createForecastSnapshot(inputWithDaily());
  const source = inputWithDaily();
  source.scenarios = [...source.scenarios]
    .reverse()
    .map(scenario => ({
      ...scenario,
      daily: [...scenario.daily].reverse()
    }));
  const second = createForecastSnapshot(source);

  assert.deepEqual(
    first.scenarios.find(scenario => scenario.name === 'base').daily,
    [
      { date: '2026-09-07', closingBalance: 100000 },
      { date: '2026-09-08', closingBalance: 110000 },
      { date: '2026-09-09', closingBalance: 120000 }
    ]
  );
  assert.deepEqual(first, second);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(verifyForecastSnapshot(first), true);
});

test('keeps fingerprint stable across equivalent negative zero values', () => {
  const first = createForecastSnapshot(input());
  const source = input();
  source.scenarios = source.scenarios.map(scenario => ({ ...scenario }));
  source.scenarios[2].cashGap = -0;
  source.scenarios[2].requiredCollection = -0;
  source.scenarios[2].safeWithdrawal = -0;

  const second = createForecastSnapshot(source);
  assert.equal(second.scenarios.find(scenario => scenario.name === 'base').cashGap, 0);
  assert.equal(first.fingerprint, second.fingerprint);
});

test('normalizes negative zero in daily balances', () => {
  const source = inputWithDaily();
  source.scenarios = source.scenarios.map(scenario => ({
    ...scenario,
    daily: scenario.daily.map(entry => ({ ...entry }))
  }));
  source.scenarios.find(scenario => scenario.name.trim() === 'conservative').daily[2].closingBalance = -0;

  const result = createForecastSnapshot(source);
  assert.equal(
    result.scenarios.find(scenario => scenario.name === 'conservative').daily[0].closingBalance,
    0
  );
});

test('detects later business-field and fingerprint tampering', () => {
  const result = createForecastSnapshot(input());

  const changedMoney = structuredClone(result);
  changedMoney.scenarios[0].requiredCollection += 1;
  assert.throws(() => verifyForecastSnapshot(changedMoney), /fingerprint mismatch/i);

  const changedFingerprint = structuredClone(result);
  changedFingerprint.fingerprint = '0'.repeat(64);
  assert.throws(() => verifyForecastSnapshot(changedFingerprint), /fingerprint mismatch/i);
});

test('detects later daily balance tampering through the snapshot fingerprint', () => {
  const result = createForecastSnapshot(inputWithDaily());
  const changed = structuredClone(result);
  changed.scenarios[0].daily[0].closingBalance += 1;

  assert.throws(() => verifyForecastSnapshot(changed), /fingerprint mismatch/i);
});

test('rejects duplicate scenario names after normalization', () => {
  const source = input();
  source.scenarios = [
    source.scenarios[0],
    { ...source.scenarios[0], name: 'target' }
  ];

  assert.throws(
    () => createForecastSnapshot(source),
    /duplicate scenario name: target/i
  );
});

test('fails closed for missing ids or versions and malformed timestamps or dates', () => {
  assert.throws(() => createForecastSnapshot(input({ snapshotId: ' ' })), /snapshotId.*required/i);
  assert.throws(() => createForecastSnapshot(input({ modelVersion: '' })), /modelVersion.*required/i);
  assert.throws(() => createForecastSnapshot(input({ generatedAt: '2026-09-06' })), /generatedAt.*timestamp/i);
  assert.throws(() => createForecastSnapshot(input({ forecastStartDate: '2026-02-30' })), /forecastStartDate.*date/i);
  assert.throws(() => createForecastSnapshot(input({ forecastEndDate: 'not-a-date' })), /forecastEndDate.*date/i);

  const source = input();
  source.scenarios[0] = { ...source.scenarios[0], minimumBalanceDate: '2026-09-31' };
  assert.throws(() => createForecastSnapshot(source), /minimumBalanceDate.*date/i);
});

test('rejects an invalid forecast range and scenario minimum dates outside the range', () => {
  assert.throws(
    () => createForecastSnapshot(input({
      forecastStartDate: '2026-09-10',
      forecastEndDate: '2026-09-09'
    })),
    /forecast range/i
  );

  const source = input();
  source.scenarios[0] = { ...source.scenarios[0], minimumBalanceDate: '2026-09-10' };
  assert.throws(
    () => createForecastSnapshot(source),
    /minimumBalanceDate.*forecast range/i
  );
});

test('fails closed for malformed or empty scenario arrays', () => {
  assert.throws(() => createForecastSnapshot(input({ scenarios: null })), /scenarios.*array/i);
  assert.throws(() => createForecastSnapshot(input({ scenarios: [] })), /scenarios.*empty/i);
  assert.throws(() => createForecastSnapshot(input({ scenarios: [null] })), /scenarios\[0\].*object/i);
  assert.throws(() => createForecastSnapshot(input({
    scenarios: [{
      name: ' ',
      minimumBalance: 0,
      minimumBalanceDate: '2026-09-07',
      cashGap: 0,
      requiredCollection: 0,
      safeWithdrawal: 0
    }]
  })), /scenarios\[0\]\.name.*required/i);
});

test('rejects malformed daily balance collections fail closed', () => {
  for (const daily of [null, {}, []]) {
    const source = inputWithDaily();
    source.scenarios[0] = { ...source.scenarios[0], daily };
    assert.throws(
      () => createForecastSnapshot(source),
      /daily.*(array|empty)/i
    );
  }

  const duplicate = inputWithDaily();
  duplicate.scenarios[0] = {
    ...duplicate.scenarios[0],
    daily: [
      { date: '2026-09-07', closingBalance: 1 },
      { date: '2026-09-07', closingBalance: 2 }
    ]
  };
  assert.throws(() => createForecastSnapshot(duplicate), /duplicate daily date/i);

  const malformedDate = inputWithDaily();
  malformedDate.scenarios[0].daily[0] = { date: '2026-09-31', closingBalance: 1 };
  assert.throws(() => createForecastSnapshot(malformedDate), /daily.*date/i);

  const outsideRange = inputWithDaily();
  outsideRange.scenarios[0].daily[0] = { date: '2026-09-10', closingBalance: 1 };
  assert.throws(() => createForecastSnapshot(outsideRange), /daily.*forecast range/i);

  const nonFinite = inputWithDaily();
  nonFinite.scenarios[0].daily[0] = { date: '2026-09-09', closingBalance: Number.NaN };
  assert.throws(() => createForecastSnapshot(nonFinite), /closingBalance.*finite/i);
});

test('rejects non-finite monetary values', () => {
  for (const [field, value] of [
    ['minimumBalance', Number.NaN],
    ['cashGap', Number.POSITIVE_INFINITY],
    ['requiredCollection', Number.NEGATIVE_INFINITY],
    ['safeWithdrawal', Number.NaN]
  ]) {
    const source = input();
    source.scenarios[0] = { ...source.scenarios[0], [field]: value };
    assert.throws(
      () => createForecastSnapshot(source),
      new RegExp(`${field}.*finite`, 'i'),
      field
    );
  }
});

test('allows negative minimum balance but rejects negative cash gap, collection and withdrawal', () => {
  const valid = createForecastSnapshot(input());
  assert.equal(valid.scenarios.find(scenario => scenario.name === 'conservative').minimumBalance, -100000);

  for (const field of ['cashGap', 'requiredCollection', 'safeWithdrawal']) {
    const source = input();
    source.scenarios[0] = { ...source.scenarios[0], [field]: -1 };
    assert.throws(
      () => createForecastSnapshot(source),
      new RegExp(`${field}.*non-negative`, 'i'),
      field
    );
  }
});

test('does not mutate inputs and returns a deeply immutable snapshot', () => {
  const source = input();
  const before = structuredClone(source);

  const result = createForecastSnapshot(source);

  assert.deepEqual(source, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.scenarios), true);
  assert.equal(Object.isFrozen(result.scenarios[0]), true);
  assert.throws(() => { result.snapshotId = 'changed'; }, TypeError);
  assert.throws(() => { result.scenarios[0].cashGap = 999; }, TypeError);
});

test('does not mutate daily inputs and deeply freezes normalized daily balances', () => {
  const source = inputWithDaily();
  const before = structuredClone(source);

  const result = createForecastSnapshot(source);
  const base = result.scenarios.find(scenario => scenario.name === 'base');

  assert.deepEqual(source, before);
  assert.equal(Object.isFrozen(base.daily), true);
  assert.equal(Object.isFrozen(base.daily[0]), true);
  assert.throws(() => { base.daily[0].closingBalance = 999; }, TypeError);
});
