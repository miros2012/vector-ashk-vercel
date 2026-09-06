import { createHash } from 'node:crypto';

const SCENARIO_ORDER = ['conservative', 'base', 'target'];
const SCENARIO_NAMES = new Set(SCENARIO_ORDER);

function requiredText(value, field) {
  if (typeof value !== 'string') throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function finiteNonNegative(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite`);
  }
  const normalized = normalizeZero(value);
  if (normalized < 0) throw new Error(`${field} must be non-negative`);
  return normalized;
}

function strictBusinessDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be a valid ISO timestamp`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a valid ISO timestamp`);
  }
}

function isoTimestamp(value, field) {
  if (typeof value !== 'string') throw new Error(`${field} must be a valid ISO timestamp`);
  const normalized = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(normalized);
  if (!match) throw new Error(`${field} must be a valid ISO timestamp`);

  strictBusinessDate(match[1], field);

  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${field} must be a valid ISO timestamp`);
  }

  if (match[6] !== 'Z') {
    const offsetHour = Number(match[6].slice(1, 3));
    const offsetMinute = Number(match[6].slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      throw new Error(`${field} must be a valid ISO timestamp`);
    }
  }

  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${field} must be a valid ISO timestamp`);
  return parsed.toISOString();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fingerprintOf(normalized) {
  return createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex');
}

function normalizeScenarioList(value) {
  if (!Array.isArray(value)) throw new Error('scenarios must be an array');
  if (value.length !== 3) throw new Error('exactly three scenarios are required');

  const seen = new Set();
  const normalized = value.map((scenario, index) => {
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
      throw new Error(`scenarios[${index}] must be an object`);
    }

    const name = requiredText(scenario.name, `scenarios[${index}].name`).toLowerCase();
    if (!SCENARIO_NAMES.has(name)) throw new Error(`unsupported scenario name: ${name}`);
    if (seen.has(name)) throw new Error(`duplicate scenario name: ${name}`);
    seen.add(name);

    return {
      name,
      inflowMultiplier: finiteNonNegative(
        scenario.inflowMultiplier,
        `scenarios[${index}].inflowMultiplier`
      ),
      outflowMultiplier: finiteNonNegative(
        scenario.outflowMultiplier,
        `scenarios[${index}].outflowMultiplier`
      )
    };
  });

  for (const requiredName of SCENARIO_ORDER) {
    if (!seen.has(requiredName)) throw new Error(`missing scenario name: ${requiredName}`);
  }

  normalized.sort((left, right) => SCENARIO_ORDER.indexOf(left.name) - SCENARIO_ORDER.indexOf(right.name));
  return normalized;
}

function normalizeBusinessFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('configuration must be an object');
  }

  return {
    configurationId: requiredText(input.configurationId, 'configurationId'),
    version: requiredText(input.version, 'version'),
    effectiveFrom: isoTimestamp(input.effectiveFrom, 'effectiveFrom'),
    requiredSafetyReserve: finiteNonNegative(input.requiredSafetyReserve, 'requiredSafetyReserve'),
    scenarios: normalizeScenarioList(input.scenarios)
  };
}

function normalizedWithFingerprint(input) {
  const normalized = normalizeBusinessFields(input);
  return deepFreeze({
    ...normalized,
    fingerprint: fingerprintOf(normalized)
  });
}

export function normalizeCashScenarioConfig(input) {
  return normalizedWithFingerprint(input);
}

export function verifyCashScenarioConfig(stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error('configuration must be an object');
  }

  const fingerprint = typeof stored.fingerprint === 'string'
    ? stored.fingerprint.trim().toLowerCase()
    : '';
  const normalized = normalizeBusinessFields(stored);
  const expected = fingerprintOf(normalized);

  if (!/^[a-f0-9]{64}$/.test(fingerprint) || fingerprint !== expected) {
    throw new Error('cash scenario configuration fingerprint mismatch');
  }
  return true;
}

export function selectEffectiveCashScenarioConfig(configurations, asOf) {
  if (!Array.isArray(configurations) || configurations.length === 0) {
    throw new Error('configurations must be a non-empty array');
  }
  const normalizedAsOf = isoTimestamp(asOf, 'asOf');
  const asOfMs = new Date(normalizedAsOf).getTime();

  const seenVersions = new Set();
  const seenEffective = new Set();
  const normalized = configurations.map((configuration, index) => {
    if (configuration && Object.prototype.hasOwnProperty.call(configuration, 'fingerprint')) {
      verifyCashScenarioConfig(configuration);
    }

    const item = normalizedWithFingerprint(configuration);
    if (seenVersions.has(item.version)) {
      throw new Error(`duplicate version: ${item.version}`);
    }
    if (seenEffective.has(item.effectiveFrom)) {
      throw new Error(`duplicate effectiveFrom: ${item.effectiveFrom}`);
    }
    seenVersions.add(item.version);
    seenEffective.add(item.effectiveFrom);

    return { item, index };
  });

  const effective = normalized
    .filter(({ item }) => new Date(item.effectiveFrom).getTime() <= asOfMs)
    .sort((left, right) => {
      const timeDiff = new Date(right.item.effectiveFrom).getTime() - new Date(left.item.effectiveFrom).getTime();
      if (timeDiff !== 0) return timeDiff;
      return left.index - right.index;
    });

  if (effective.length === 0) {
    throw new Error('no configuration effective at the supplied timestamp');
  }

  return effective[0].item;
}
