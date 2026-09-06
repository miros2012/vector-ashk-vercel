import { selectEffectiveCashScenarioConfig } from './cash-scenario-config.js';
import { buildCashScenarioForecast } from './cash-scenario-forecast.js';
import { calculateSafeWithdrawal } from './safe-withdrawal-policy.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function buildConfiguredCashScenarioPolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('input is required');
  }

  const configuration = selectEffectiveCashScenarioConfig(
    input.configurations,
    input.asOf
  );

  const forecast = buildCashScenarioForecast({
    openingCash: input.openingCash,
    safetyReserve: configuration.requiredSafetyReserve,
    flows: input.flows,
    scenarios: configuration.scenarios.map((scenario) => ({
      name: scenario.name,
      inflowMultiplier: scenario.inflowMultiplier,
      outflowMultiplier: scenario.outflowMultiplier
    }))
  });

  const scenarioCaps = Object.fromEntries(
    forecast.scenarios.map((scenario) => [
      scenario.name,
      scenario.safeOwnerWithdrawal
    ])
  );

  const withdrawal = calculateSafeWithdrawal({
    availableCash: input.availableCash,
    confirmedObligations: input.confirmedObligations,
    unconfirmedObligationReserve: input.unconfirmedObligationReserve,
    requiredOperatingReserve: input.requiredOperatingReserve,
    drivingFundDeficit: input.drivingFundDeficit,
    scenarioCaps,
    dataHealthStatus: input.dataHealthStatus,
    blockingReasons: input.blockingReasons,
    policyMode: input.policyMode
  });

  return deepFreeze({
    configuration,
    forecast,
    scenarioCaps,
    withdrawal
  });
}
