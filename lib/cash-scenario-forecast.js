const REQUIRED_SCENARIOS = Object.freeze(['conservative', 'base', 'target']);
const REQUIRED_SCENARIO_SET = new Set(REQUIRED_SCENARIOS);

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function finiteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite`);
  }
  return normalizeZero(value);
}

function nonNegativeNumber(value, field) {
  const normalized = finiteNumber(value, field);
  if (normalized < 0) throw new Error(`${field} must be non-negative`);
  return normalized;
}

function strictBusinessDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

function checkedMultiply(left, right, field) {
  const result = left * right;
  if (!Number.isFinite(result)) throw new Error(`${field} must be finite`);
  return normalizeZero(result);
}

function checkedBalance(balance, inflow, outflow, field) {
  const result = balance + inflow - outflow;
  if (!Number.isFinite(result)) throw new Error(`${field} must be finite`);
  return normalizeZero(result);
}

function normalizeFlows(value) {
  if (!Array.isArray(value)) throw new Error('flows must be an array');
  if (value.length === 0) throw new Error('flows must not be empty');

  const seenDates = new Set();
  const flows = value.map((flow, index) => {
    if (!flow || typeof flow !== 'object' || Array.isArray(flow)) {
      throw new Error(`flows[${index}] must be an object`);
    }

    const date = strictBusinessDate(flow.date, `flows[${index}].date`);
    if (seenDates.has(date)) throw new Error(`duplicate flow date: ${date}`);
    seenDates.add(date);

    return {
      date,
      inflow: nonNegativeNumber(flow.inflow, `flows[${index}].inflow`),
      outflow: nonNegativeNumber(flow.outflow, `flows[${index}].outflow`)
    };
  });

  return flows.sort((left, right) => left.date.localeCompare(right.date, 'en'));
}

function normalizeScenarios(value) {
  if (!Array.isArray(value)) throw new Error('scenarios must be an array');
  if (value.length !== REQUIRED_SCENARIOS.length) {
    throw new Error('exactly three scenarios are required');
  }

  const seenNames = new Set();
  const scenariosByName = new Map();

  for (let index = 0; index < value.length; index += 1) {
    const scenario = value[index];
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
      throw new Error(`scenarios[${index}] must be an object`);
    }

    if (typeof scenario.name !== 'string' || !scenario.name.trim()) {
      throw new Error(`scenarios[${index}].name is required`);
    }
    const name = scenario.name.trim();
    if (seenNames.has(name)) throw new Error(`duplicate scenario name: ${name}`);
    seenNames.add(name);

    scenariosByName.set(name, {
      name,
      inflowMultiplier: nonNegativeNumber(
        scenario.inflowMultiplier,
        `scenarios[${index}].inflowMultiplier`
      ),
      outflowMultiplier: nonNegativeNumber(
        scenario.outflowMultiplier,
        `scenarios[${index}].outflowMultiplier`
      )
    });
  }

  if (!scenariosByName.has('base')) throw new Error('base scenario is required');

  for (const name of scenariosByName.keys()) {
    if (!REQUIRED_SCENARIO_SET.has(name)) {
      throw new Error(`unsupported scenario name: ${name}`);
    }
  }

  return REQUIRED_SCENARIOS.map(name => scenariosByName.get(name));
}

function buildScenario(openingCash, flows, scenario, safetyReserve) {
  let balance = openingCash;
  let minimumBalance = Number.POSITIVE_INFINITY;
  let minimumBalanceDate = null;

  const daily = flows.map(flow => {
    const inflow = checkedMultiply(
      flow.inflow,
      scenario.inflowMultiplier,
      `${scenario.name}.${flow.date}.inflow`
    );
    const outflow = checkedMultiply(
      flow.outflow,
      scenario.outflowMultiplier,
      `${scenario.name}.${flow.date}.outflow`
    );
    balance = checkedBalance(
      balance,
      inflow,
      outflow,
      `${scenario.name}.${flow.date}.closingBalance`
    );

    if (balance < minimumBalance) {
      minimumBalance = balance;
      minimumBalanceDate = flow.date;
    }

    return {
      date: flow.date,
      inflow,
      outflow,
      closingBalance: balance
    };
  });

  const cashGap = normalizeZero(Math.max(0, -minimumBalance));
  const requiredCollection = normalizeZero(Math.max(0, safetyReserve - minimumBalance));
  const safeOwnerWithdrawal = normalizeZero(Math.max(0, minimumBalance - safetyReserve));

  return {
    name: scenario.name,
    inflowMultiplier: scenario.inflowMultiplier,
    outflowMultiplier: scenario.outflowMultiplier,
    daily,
    minimumBalance,
    minimumBalanceDate,
    cashGap,
    requiredCollection,
    safeOwnerWithdrawal
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function buildCashScenarioForecast(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('input is required');
  }

  const openingCash = nonNegativeNumber(input.openingCash, 'openingCash');
  const safetyReserve = nonNegativeNumber(input.safetyReserve, 'safetyReserve');
  const flows = normalizeFlows(input.flows);
  const scenarios = normalizeScenarios(input.scenarios);

  const result = {
    openingCash,
    safetyReserve,
    horizon: flows.map(flow => flow.date),
    scenarios: scenarios.map(scenario => (
      buildScenario(openingCash, flows, scenario, safetyReserve)
    ))
  };

  return deepFreeze(result);
}
