const POLICY_SCENARIOS = Object.freeze({
  CONSERVATIVE: Object.freeze(['conservative']),
  BASE: Object.freeze(['base']),
  TARGET: Object.freeze(['target']),
  ALL: Object.freeze(['conservative', 'base', 'target'])
});

const SUPPORTED_HEALTH_STATUSES = new Set(['OK', 'DELAYED', 'ERROR', 'BLOCKED']);
const SCENARIO_LIMIT_IDS = Object.freeze({
  conservative: 'SCENARIO_CONSERVATIVE',
  base: 'SCENARIO_BASE',
  target: 'SCENARIO_TARGET'
});

function normalizedNonNegativeNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite`);
  }
  if (value < 0) throw new Error(`${field} must be non-negative`);
  return Object.is(value, -0) ? 0 : value;
}

function normalizeBlockingReasons(value) {
  if (!Array.isArray(value)) throw new Error('blockingReasons must be an array');
  const normalized = [];
  const seen = new Set();

  for (const reason of value) {
    if (typeof reason !== 'string') throw new Error('blocking reason is required');
    const clean = reason.trim().replace(/\s+/g, ' ');
    if (!clean) throw new Error('blocking reason is required');
    if (seen.has(clean)) throw new Error(`duplicate blocking reason: ${clean}`);
    seen.add(clean);
    normalized.push(clean);
  }

  return normalized.sort((left, right) => left.localeCompare(right, 'en'));
}

function normalizeScenarioCaps(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('scenarioCaps must be an object');
  }
  return {
    conservative: normalizedNonNegativeNumber(value.conservative, 'scenarioCaps.conservative'),
    base: normalizedNonNegativeNumber(value.base, 'scenarioCaps.base'),
    target: normalizedNonNegativeNumber(value.target, 'scenarioCaps.target')
  };
}

function checkedSum(values, field) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total)) throw new Error(`${field} must be finite`);
  return Object.is(total, -0) ? 0 : total;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function calculateSafeWithdrawal(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('input is required');
  }

  const policyMode = String(input.policyMode ?? '').trim();
  if (!Object.hasOwn(POLICY_SCENARIOS, policyMode)) {
    throw new Error('policyMode is unsupported');
  }

  const dataHealthStatus = String(input.dataHealthStatus ?? '').trim();
  if (!SUPPORTED_HEALTH_STATUSES.has(dataHealthStatus)) {
    throw new Error('dataHealthStatus is unsupported');
  }

  const reasons = normalizeBlockingReasons(input.blockingReasons);
  if (dataHealthStatus === 'OK' && reasons.length) {
    throw new Error('OK Data Health cannot contain blocking reasons');
  }
  if (dataHealthStatus !== 'OK' && !reasons.length) {
    throw new Error('non-OK Data Health requires blocking reasons');
  }

  const availableCash = normalizedNonNegativeNumber(input.availableCash, 'availableCash');
  const protectedComponents = {
    confirmedObligations: normalizedNonNegativeNumber(
      input.confirmedObligations,
      'confirmedObligations'
    ),
    unconfirmedObligationReserve: normalizedNonNegativeNumber(
      input.unconfirmedObligationReserve,
      'unconfirmedObligationReserve'
    ),
    requiredOperatingReserve: normalizedNonNegativeNumber(
      input.requiredOperatingReserve,
      'requiredOperatingReserve'
    ),
    drivingFundDeficit: normalizedNonNegativeNumber(
      input.drivingFundDeficit,
      'drivingFundDeficit'
    )
  };
  const scenarioCaps = normalizeScenarioCaps(input.scenarioCaps);
  const requiredScenarioCaps = [...POLICY_SCENARIOS[policyMode]];

  const protectedNeedsTotal = checkedSum(
    Object.values(protectedComponents),
    'protectedNeedsTotal'
  );
  const liquidityCapacity = Math.max(0, availableCash - protectedNeedsTotal);
  const constraints = [
    { id: 'LIQUIDITY_CAP', amount: liquidityCapacity },
    ...requiredScenarioCaps.map(name => ({
      id: SCENARIO_LIMIT_IDS[name],
      amount: scenarioCaps[name]
    }))
  ];
  const bindingConstraint = constraints.reduce((current, candidate) => (
    candidate.amount < current.amount ? candidate : current
  ));

  const blocked = dataHealthStatus !== 'OK';
  const safeWithdrawal = blocked ? 0 : bindingConstraint.amount;
  const liquidityRemainingRaw = availableCash - safeWithdrawal;
  const liquidityRemaining = Object.is(liquidityRemainingRaw, -0) ? 0 : liquidityRemainingRaw;
  const uncommittedLiquidityRemaining = Math.max(
    0,
    liquidityRemaining - protectedNeedsTotal
  );
  const protectionShortfall = Math.max(
    0,
    protectedNeedsTotal - liquidityRemaining
  );

  const constraintOrder = constraints.map(constraint => constraint.id);
  const result = {
    policyMode,
    dataHealthStatus,
    blocked,
    reasons,
    safeWithdrawal,
    liquidityRemaining,
    uncommittedLiquidityRemaining,
    protectionShortfall,
    limits: {
      availableCash,
      protectedComponents,
      protectedNeedsTotal,
      liquidityCapacity,
      scenarioCaps,
      requiredScenarioCaps: [...requiredScenarioCaps],
      scenarioCapacity: Math.min(...requiredScenarioCaps.map(name => scenarioCaps[name]))
    },
    bindingLimit: blocked
      ? { id: 'DATA_HEALTH', amount: 0 }
      : { ...bindingConstraint },
    explanation: {
      policyMode,
      requiredScenarioCaps: [...requiredScenarioCaps],
      constraintOrder,
      calculation: 'MIN_OF_MANDATORY_LIMITS'
    }
  };

  return deepFreeze(result);
}
