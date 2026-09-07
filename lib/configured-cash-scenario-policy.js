import { selectEffectiveCashScenarioConfig } from './cash-scenario-config.js';
import { buildCashScenarioForecast } from './cash-scenario-forecast.js';
import { calculateSafeWithdrawal } from './safe-withdrawal-policy.js';

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function strictBusinessDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

function nonNegativeNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite`);
  }
  const normalized = normalizeZero(value);
  if (normalized < 0) throw new Error(`${field} must be non-negative`);
  return normalized;
}

function normalizeProtectedReserves(value, horizon) {
  if (value === undefined) return null;
  if (!Array.isArray(value)) throw new Error('protectedReserves must be an array');

  const seenDates = new Set();
  const reserves = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`protectedReserves[${index}] must be an object`);
    }
    const date = strictBusinessDate(entry.date, `protectedReserves[${index}].date`);
    if (seenDates.has(date)) throw new Error(`duplicate protected reserve date: ${date}`);
    seenDates.add(date);
    return {
      date,
      amount: nonNegativeNumber(entry.amount, `protectedReserves[${index}].amount`)
    };
  }).sort((left, right) => left.date.localeCompare(right.date, 'en'));

  const expected = [...horizon].sort((left, right) => left.localeCompare(right, 'en'));
  if (reserves.length !== expected.length
      || reserves.some((entry, index) => entry.date !== expected[index])) {
    throw new Error('protected reserves must match the forecast horizon exactly');
  }

  return reserves;
}

function buildScenarioCaps(forecast, protectedReserves) {
  if (protectedReserves === null) {
    return Object.fromEntries(
      forecast.scenarios.map((scenario) => [
        scenario.name,
        scenario.safeOwnerWithdrawal
      ])
    );
  }

  const reserveByDate = new Map(
    protectedReserves.map((entry) => [entry.date, entry.amount])
  );

  return Object.fromEntries(
    forecast.scenarios.map((scenario) => {
      let capacity = Number.POSITIVE_INFINITY;
      for (const day of scenario.daily) {
        const freeAfterReserves = day.closingBalance
          - reserveByDate.get(day.date)
          - forecast.safetyReserve;
        capacity = Math.min(capacity, freeAfterReserves);
      }
      return [scenario.name, normalizeZero(Math.max(0, capacity))];
    })
  );
}

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

  const protectedReserves = normalizeProtectedReserves(
    input.protectedReserves,
    forecast.horizon
  );
  const scenarioCaps = buildScenarioCaps(forecast, protectedReserves);

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
    protectedReserves: protectedReserves ?? [],
    scenarioCaps,
    withdrawal
  });
}
