import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCashScenarioConfig,
  selectEffectiveCashScenarioConfig,
  verifyCashScenarioConfig
} from '../lib/cash-scenario-config.js';

function baseConfig(overrides = {}) {
  return {
    configurationId: 'cash-policy',
    version: 'v1',
    effectiveFrom: '2026-09-01T00:00:00+05:00',
    requiredSafetyReserve: 150000,
    scenarios: [
      { name: 'target', inflowMultiplier: 1.15, outflowMultiplier: 0.95 },
      { name: 'conservative', inflowMultiplier: 0.8, outflowMultiplier: 1.2 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 }
    ],
    ...overrides
  };
}

test('normalizes one configuration deterministically and fingerprints it', () => {
  const result = normalizeCashScenarioConfig(baseConfig());

  assert.deepEqual(result, {
    configurationId: 'cash-policy',
    version: 'v1',
    effectiveFrom: '2026-08-31T19:00:00.000Z',
    requiredSafetyReserve: 150000,
    scenarios: [
      { name: 'conservative', inflowMultiplier: 0.8, outflowMultiplier: 1.2 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'target', inflowMultiplier: 1.15, outflowMultiplier: 0.95 }
    ],
    fingerprint: result.fingerprint
  });
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.scenarios), true);
  assert.equal(Object.isFrozen(result.scenarios[0]), true);
});

test('fingerprint is stable regardless of scenario input order and text padding', () => {
  const first = normalizeCashScenarioConfig(baseConfig());
  const second = normalizeCashScenarioConfig(baseConfig({
    configurationId: '  cash-policy  ',
    version: ' v1 ',
    scenarios: [
      { name: ' BASE ', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'TARGET', inflowMultiplier: 1.15, outflowMultiplier: 0.95 },
      { name: 'conservative', inflowMultiplier: 0.8, outflowMultiplier: 1.2 }
    ]
  }));

  assert.equal(first.fingerprint, second.fingerprint);
  assert.deepEqual(first, second);
});

test('selects the latest configuration effective at the supplied timestamp', () => {
  const configs = [
    baseConfig({ version: 'v3', effectiveFrom: '2026-09-10T00:00:00Z' }),
    baseConfig({ version: 'v1', effectiveFrom: '2026-09-01T00:00:00Z' }),
    baseConfig({ version: 'v2', effectiveFrom: '2026-09-05T00:00:00Z', requiredSafetyReserve: 200000 })
  ];

  const selected = selectEffectiveCashScenarioConfig(configs, '2026-09-06T12:00:00Z');

  assert.equal(selected.version, 'v2');
  assert.equal(selected.requiredSafetyReserve, 200000);
  assert.match(selected.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(selected), true);
});

test('effective-date selection is inclusive at the boundary', () => {
  const selected = selectEffectiveCashScenarioConfig([
    baseConfig({ version: 'v1', effectiveFrom: '2026-09-01T00:00:00Z' }),
    baseConfig({ version: 'v2', effectiveFrom: '2026-09-05T00:00:00Z' })
  ], '2026-09-05T00:00:00Z');

  assert.equal(selected.version, 'v2');
});

test('verifies a stored fingerprint and detects tampering', () => {
  const stored = normalizeCashScenarioConfig(baseConfig());
  assert.equal(verifyCashScenarioConfig(stored), true);

  const tampered = structuredClone(stored);
  tampered.requiredSafetyReserve += 1;
  assert.throws(
    () => verifyCashScenarioConfig(tampered),
    /fingerprint mismatch/i
  );
});

test('rejects duplicate versions and duplicate effective timestamps in a configuration history', () => {
  assert.throws(
    () => selectEffectiveCashScenarioConfig([
      baseConfig({ version: 'v1', effectiveFrom: '2026-09-01T00:00:00Z' }),
      baseConfig({ version: 'v1', effectiveFrom: '2026-09-02T00:00:00Z' })
    ], '2026-09-03T00:00:00Z'),
    /duplicate version/i
  );

  assert.throws(
    () => selectEffectiveCashScenarioConfig([
      baseConfig({ version: 'v1', effectiveFrom: '2026-09-01T00:00:00Z' }),
      baseConfig({ version: 'v2', effectiveFrom: '2026-09-01T00:00:00Z' })
    ], '2026-09-03T00:00:00Z'),
    /duplicate effectiveFrom/i
  );
});

test('requires exactly conservative, base, and target once each', () => {
  assert.throws(
    () => normalizeCashScenarioConfig(baseConfig({
      scenarios: [
        { name: 'conservative', inflowMultiplier: 0.8, outflowMultiplier: 1.2 },
        { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 }
      ]
    })),
    /exactly three scenarios/i
  );

  assert.throws(
    () => normalizeCashScenarioConfig(baseConfig({
      scenarios: [
        { name: 'conservative', inflowMultiplier: 0.8, outflowMultiplier: 1.2 },
        { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
        { name: 'BASE', inflowMultiplier: 1, outflowMultiplier: 1 }
      ]
    })),
    /duplicate scenario name/i
  );

  assert.throws(
    () => normalizeCashScenarioConfig(baseConfig({
      scenarios: [
        { name: 'conservative', inflowMultiplier: 0.8, outflowMultiplier: 1.2 },
        { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
        { name: 'optimistic', inflowMultiplier: 1.2, outflowMultiplier: 0.9 }
      ]
    })),
    /unsupported scenario name/i
  );
});

test('fails closed for missing identifiers and malformed timestamps', () => {
  assert.throws(
    () => normalizeCashScenarioConfig(baseConfig({ configurationId: '   ' })),
    /configurationId is required/i
  );
  assert.throws(
    () => normalizeCashScenarioConfig(baseConfig({ version: '' })),
    /version is required/i
  );
  assert.throws(
    () => normalizeCashScenarioConfig(baseConfig({ effectiveFrom: '2026-09-01' })),
    /effectiveFrom must be a valid ISO timestamp/i
  );
  assert.throws(
    () => selectEffectiveCashScenarioConfig([baseConfig()], 'not-a-timestamp'),
    /asOf must be a valid ISO timestamp/i
  );
});

test('fails closed for negative or non-finite reserve and multipliers', () => {
  for (const requiredSafetyReserve of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => normalizeCashScenarioConfig(baseConfig({ requiredSafetyReserve })),
      /requiredSafetyReserve must be (?:finite|non-negative)/i
    );
  }

  const negativeMultiplier = baseConfig();
  negativeMultiplier.scenarios[0].inflowMultiplier = -0.1;
  assert.throws(
    () => normalizeCashScenarioConfig(negativeMultiplier),
    /inflowMultiplier must be non-negative/i
  );

  const nonFiniteMultiplier = baseConfig();
  nonFiniteMultiplier.scenarios[0].outflowMultiplier = Number.POSITIVE_INFINITY;
  assert.throws(
    () => normalizeCashScenarioConfig(nonFiniteMultiplier),
    /outflowMultiplier must be finite/i
  );
});

test('fails when no configuration is effective at the requested timestamp', () => {
  assert.throws(
    () => selectEffectiveCashScenarioConfig([
      baseConfig({ effectiveFrom: '2026-09-05T00:00:00Z' })
    ], '2026-09-04T23:59:59Z'),
    /no configuration effective/i
  );
});

test('selection rejects a stored configuration with a mismatched fingerprint', () => {
  const stored = structuredClone(normalizeCashScenarioConfig(baseConfig()));
  stored.scenarios[0].inflowMultiplier = 0.81;

  assert.throws(
    () => selectEffectiveCashScenarioConfig([stored], '2026-09-02T00:00:00Z'),
    /fingerprint mismatch/i
  );
});

test('helpers never mutate caller inputs and normalize negative zero', () => {
  const input = baseConfig({ requiredSafetyReserve: -0 });
  input.scenarios[0].outflowMultiplier = -0;
  const before = structuredClone(input);

  const normalized = normalizeCashScenarioConfig(input);

  assert.deepEqual(input, before);
  assert.equal(Object.is(normalized.requiredSafetyReserve, -0), false);
  assert.equal(Object.is(normalized.scenarios[2].outflowMultiplier, -0), false);
  assert.throws(() => { normalized.scenarios.push({}); }, TypeError);
});
