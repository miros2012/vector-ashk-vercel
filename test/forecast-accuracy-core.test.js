import test from 'node:test';
import assert from 'node:assert/strict';
import { createForecastSnapshot } from '../lib/forecast-snapshot-journal.js';
import { measureForecastAccuracy } from '../lib/forecast-accuracy-core.js';

function snapshot(overrides = {}) {
  return createForecastSnapshot({
    snapshotId: 'forecast-accuracy-fixture',
    generatedAt: '2026-09-06T18:00:00Z',
    modelVersion: 'cash-forecast-v1',
    forecastStartDate: '2026-09-07',
    forecastEndDate: '2026-09-09',
    scenarios: [
      {
        name: 'base',
        minimumBalance: 100,
        minimumBalanceDate: '2026-09-07',
        cashGap: 0,
        requiredCollection: 0,
        safeWithdrawal: 0,
        daily: [
          { date: '2026-09-09', closingBalance: 300 },
          { date: '2026-09-07', closingBalance: 100 },
          { date: '2026-09-08', closingBalance: 200 }
        ]
      },
      {
        name: 'target',
        minimumBalance: 150,
        minimumBalanceDate: '2026-09-07',
        cashGap: 0,
        requiredCollection: 0,
        safeWithdrawal: 25,
        daily: [
          { date: '2026-09-07', closingBalance: 150 },
          { date: '2026-09-08', closingBalance: 250 },
          { date: '2026-09-09', closingBalance: 350 }
        ]
      }
    ],
    ...overrides
  });
}

function actuals(values = [100, 200, 300]) {
  return [
    { date: '2026-09-07', closingBalance: values[0] },
    { date: '2026-09-08', closingBalance: values[1] },
    { date: '2026-09-09', closingBalance: values[2] }
  ];
}

function measure(overrides = {}) {
  return measureForecastAccuracy({
    forecastSnapshot: snapshot(),
    actualBalances: actuals(),
    scenarioName: ' base ',
    minimumSampleThreshold: 3,
    ...overrides
  });
}

test('returns zero error metrics for a perfect forecast', () => {
  const result = measure();

  assert.equal(result.scenarioName, 'base');
  assert.equal(result.sampleCount, 3);
  assert.equal(result.minimumSampleThreshold, 3);
  assert.equal(result.sampleThresholdMet, true);
  assert.equal(result.meanAbsoluteError, 0);
  assert.equal(result.signedBias, 0);
  assert.deepEqual(result.maximumAbsoluteError, { value: 0, date: '2026-09-07' });
  assert.equal(result.meanAbsolutePercentageError, 0);
  assert.equal(result.mapeSampleCount, 3);
  assert.equal(result.coverageRatio, 1);
  assert.deepEqual(result.missingActualDates, []);
  assert.deepEqual(result.missingForecastDates, []);
  assert.deepEqual(result.zeroActualDates, []);
  assert.deepEqual(result.matchedObservations, [
    {
      date: '2026-09-07',
      forecastBalance: 100,
      actualBalance: 100,
      signedError: 0,
      absoluteError: 0,
      absolutePercentageError: 0
    },
    {
      date: '2026-09-08',
      forecastBalance: 200,
      actualBalance: 200,
      signedError: 0,
      absoluteError: 0,
      absolutePercentageError: 0
    },
    {
      date: '2026-09-09',
      forecastBalance: 300,
      actualBalance: 300,
      signedError: 0,
      absoluteError: 0,
      absolutePercentageError: 0
    }
  ]);
});

test('reports positive bias for over-forecasting and negative bias for under-forecasting', () => {
  const over = measure({ actualBalances: actuals([90, 180, 270]) });
  assert.equal(over.signedBias, 20);
  assert.equal(over.meanAbsoluteError, 20);

  const under = measure({ actualBalances: actuals([110, 220, 330]) });
  assert.equal(under.signedBias, -20);
  assert.equal(under.meanAbsoluteError, 20);
});

test('reports the maximum absolute error with deterministic earliest-date tie breaking', () => {
  const result = measure({ actualBalances: actuals([90, 220, 280]) });

  assert.deepEqual(result.maximumAbsoluteError, { value: 20, date: '2026-09-08' });
});

test('uses explicit zero-actual MAPE policy without silently dropping matched observations', () => {
  const result = measure({ actualBalances: actuals([0, 200, 0]) });

  assert.equal(result.sampleCount, 3);
  assert.equal(result.matchedObservations.length, 3);
  assert.equal(result.matchedObservations[0].absolutePercentageError, null);
  assert.equal(result.matchedObservations[2].absolutePercentageError, null);
  assert.deepEqual(result.zeroActualDates, ['2026-09-07', '2026-09-09']);
  assert.equal(result.mapeSampleCount, 1);
  assert.equal(result.meanAbsolutePercentageError, 0);
  assert.equal(result.mapeZeroActualPolicy, 'exclude-zero-actual-and-report');
});

test('returns null MAPE when every matched actual balance is zero', () => {
  const result = measure({ actualBalances: actuals([0, 0, 0]) });

  assert.equal(result.meanAbsolutePercentageError, null);
  assert.equal(result.mapeSampleCount, 0);
  assert.deepEqual(result.zeroActualDates, ['2026-09-07', '2026-09-08', '2026-09-09']);
});

test('reports partial coverage and missing actual dates explicitly', () => {
  const result = measure({
    actualBalances: [
      { date: '2026-09-07', closingBalance: 100 },
      { date: '2026-09-09', closingBalance: 300 }
    ],
    minimumSampleThreshold: 2
  });

  assert.equal(result.sampleCount, 2);
  assert.equal(result.coverageRatio, 2 / 3);
  assert.deepEqual(result.missingActualDates, ['2026-09-08']);
  assert.deepEqual(result.missingForecastDates, []);
  assert.equal(result.sampleThresholdMet, true);
});

test('reports actual dates that have no forecast observation', () => {
  const result = measure({
    actualBalances: [
      ...actuals(),
      { date: '2026-09-10', closingBalance: 400 }
    ]
  });

  assert.deepEqual(result.missingForecastDates, ['2026-09-10']);
  assert.equal(result.coverageRatio, 1);
  assert.equal(result.sampleCount, 3);
});

test('honors the exact minimum sample threshold boundary', () => {
  const met = measure({ minimumSampleThreshold: 3 });
  assert.equal(met.sampleThresholdMet, true);

  const notMet = measure({ minimumSampleThreshold: 4 });
  assert.equal(notMet.sampleThresholdMet, false);
});

test('selects the requested scenario after deterministic normalization', () => {
  const result = measure({ scenarioName: ' TARGET ' });

  assert.equal(result.scenarioName, 'target');
  assert.equal(result.meanAbsoluteError, 50);
  assert.equal(result.signedBias, 50);
});

test('fails closed for an invalid forecast fingerprint', () => {
  const invalid = structuredClone(snapshot());
  invalid.scenarios[0].daily[0].closingBalance += 1;

  assert.throws(
    () => measure({ forecastSnapshot: invalid }),
    /fingerprint mismatch/i
  );
});

test('fails closed for unknown scenarios and forecast scenarios without daily balances', () => {
  assert.throws(() => measure({ scenarioName: 'missing' }), /unknown scenario/i);

  const aggregateOnly = createForecastSnapshot({
    snapshotId: 'aggregate-only',
    generatedAt: '2026-09-06T18:00:00Z',
    modelVersion: 'cash-forecast-v1',
    forecastStartDate: '2026-09-07',
    forecastEndDate: '2026-09-09',
    scenarios: [{
      name: 'base',
      minimumBalance: 0,
      minimumBalanceDate: '2026-09-07',
      cashGap: 0,
      requiredCollection: 0,
      safeWithdrawal: 0
    }]
  });

  assert.throws(
    () => measure({ forecastSnapshot: aggregateOnly }),
    /daily.*required|forecast horizon.*empty/i
  );
});

test('fails closed for duplicate actual dates', () => {
  assert.throws(
    () => measure({
      actualBalances: [
        { date: '2026-09-07', closingBalance: 1 },
        { date: '2026-09-07', closingBalance: 2 }
      ]
    }),
    /duplicate actual date/i
  );
});

test('fails closed for malformed dates and non-finite actual balances', () => {
  assert.throws(
    () => measure({ actualBalances: [{ date: '2026-09-31', closingBalance: 1 }] }),
    /actualBalances\[0\]\.date.*valid/i
  );
  assert.throws(
    () => measure({ actualBalances: [{ date: '2026-09-07', closingBalance: Number.NaN }] }),
    /actualBalances\[0\]\.closingBalance.*finite/i
  );
});

test('fails closed for malformed actual collections and invalid sample thresholds', () => {
  for (const value of [null, {}, []]) {
    assert.throws(
      () => measure({ actualBalances: value }),
      /actualBalances.*(array|empty)/i
    );
  }

  for (const value of [0, -1, 1.5, Number.NaN, '3']) {
    assert.throws(
      () => measure({ minimumSampleThreshold: value }),
      /minimumSampleThreshold.*positive integer/i
    );
  }
});

test('does not mutate inputs and returns a deeply immutable result', () => {
  const forecastSnapshot = snapshot();
  const actualBalances = actuals();
  const beforeForecast = structuredClone(forecastSnapshot);
  const beforeActuals = structuredClone(actualBalances);

  const result = measureForecastAccuracy({
    forecastSnapshot,
    actualBalances,
    scenarioName: 'base',
    minimumSampleThreshold: 2
  });

  assert.deepEqual(forecastSnapshot, beforeForecast);
  assert.deepEqual(actualBalances, beforeActuals);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.matchedObservations), true);
  assert.equal(Object.isFrozen(result.matchedObservations[0]), true);
  assert.equal(Object.isFrozen(result.missingActualDates), true);
  assert.throws(() => { result.meanAbsoluteError = 999; }, TypeError);
  assert.throws(() => { result.matchedObservations[0].actualBalance = 999; }, TypeError);
});
