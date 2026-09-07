import { normalizeCashScenarioConfig } from './cash-scenario-config.js';

const configuration = normalizeCashScenarioConfig({
  configurationId: 'vector-owner-cash-policy',
  version: 'v1',
  effectiveFrom: '2026-09-07T00:00:00+05:00',
  requiredSafetyReserve: 300000,
  scenarios: [
    { name: 'conservative', inflowMultiplier: 0.85, outflowMultiplier: 1.05 },
    { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
    { name: 'target', inflowMultiplier: 1.1, outflowMultiplier: 0.97 }
  ]
});

export const VECTOR_OWNER_CASH_CONFIGURATIONS = Object.freeze([configuration]);

export const VECTOR_OWNER_CASH_POLICY = Object.freeze({
  configurationId: 'vector-owner-cash-policy',
  policyMode: 'ALL'
});
