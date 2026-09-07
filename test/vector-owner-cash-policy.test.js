import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VECTOR_OWNER_CASH_POLICY,
  VECTOR_OWNER_CASH_CONFIGURATIONS
} from '../lib/vector-owner-cash-policy.js';
import {
  selectEffectiveCashScenarioConfig,
  verifyCashScenarioConfig
} from '../lib/cash-scenario-config.js';

test('locks the owner-approved v1 policy exactly', () => {
  assert.equal(VECTOR_OWNER_CASH_POLICY.policyMode, 'ALL');
  assert.equal(VECTOR_OWNER_CASH_POLICY.configurationId, 'vector-owner-cash-policy');
  assert.equal(VECTOR_OWNER_CASH_CONFIGURATIONS.length, 1);

  const [config] = VECTOR_OWNER_CASH_CONFIGURATIONS;
  assert.equal(config.configurationId, 'vector-owner-cash-policy');
  assert.equal(config.version, 'v1');
  assert.equal(config.effectiveFrom, '2026-09-06T19:00:00.000Z');
  assert.equal(config.requiredSafetyReserve, 300000);
  assert.deepEqual(config.scenarios, [
    { name: 'conservative', inflowMultiplier: 0.85, outflowMultiplier: 1.05 },
    { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
    { name: 'target', inflowMultiplier: 1.1, outflowMultiplier: 0.97 }
  ]);
});

test('stores a valid normalized fingerprinted configuration', () => {
  const [config] = VECTOR_OWNER_CASH_CONFIGURATIONS;

  assert.equal(verifyCashScenarioConfig(config), true);
  assert.match(config.fingerprint, /^[a-f0-9]{64}$/);
});

test('becomes effective at midnight 7 September Tyumen time and not before', () => {
  assert.throws(
    () => selectEffectiveCashScenarioConfig(
      VECTOR_OWNER_CASH_CONFIGURATIONS,
      '2026-09-06T18:59:59.999Z'
    ),
    /no configuration effective/i
  );

  const selected = selectEffectiveCashScenarioConfig(
    VECTOR_OWNER_CASH_CONFIGURATIONS,
    '2026-09-06T19:00:00.000Z'
  );
  assert.equal(selected.version, 'v1');
});

test('exports a deeply immutable policy and history', () => {
  assert.equal(Object.isFrozen(VECTOR_OWNER_CASH_POLICY), true);
  assert.equal(Object.isFrozen(VECTOR_OWNER_CASH_CONFIGURATIONS), true);
  assert.equal(Object.isFrozen(VECTOR_OWNER_CASH_CONFIGURATIONS[0]), true);
  assert.equal(Object.isFrozen(VECTOR_OWNER_CASH_CONFIGURATIONS[0].scenarios), true);
  assert.equal(Object.isFrozen(VECTOR_OWNER_CASH_CONFIGURATIONS[0].scenarios[0]), true);

  assert.throws(() => {
    VECTOR_OWNER_CASH_POLICY.policyMode = 'BASE';
  }, TypeError);
  assert.throws(() => {
    VECTOR_OWNER_CASH_CONFIGURATIONS.push({});
  }, TypeError);
  assert.throws(() => {
    VECTOR_OWNER_CASH_CONFIGURATIONS[0].requiredSafetyReserve = 1;
  }, TypeError);
});
