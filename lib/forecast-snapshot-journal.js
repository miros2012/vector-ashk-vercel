import { createHash } from 'node:crypto';

function requiredText(value, field) {
  if (typeof value !== 'string') throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function finiteMoney(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite`);
  }
  return normalizeZero(value);
}

function nonNegativeMoney(value, field) {
  const normalized = finiteMoney(value, field);
  if (normalized < 0) throw new Error(`${field} must be non-negative`);
  return normalized;
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

function isoTimestamp(value, field) {
  if (typeof value !== 'string') throw new Error(`${field} must be a valid ISO timestamp`);
  const normalized = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(normalized);
  if (!match) throw new Error(`${field} must be a valid ISO timestamp`);

  try {
    strictBusinessDate(match[1], field);
  } catch {
    throw new Error(`${field} must be a valid ISO timestamp`);
  }

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

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeDaily(value, scenarioIndex, forecastStartDate, forecastEndDate) {
  const field = `scenarios[${scenarioIndex}].daily`;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (value.length === 0) throw new Error(`${field} must not be empty`);

  const seenDates = new Set();
  const daily = value.map((entry, entryIndex) => {
    const entryField = `${field}[${entryIndex}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${entryField} must be an object`);
    }

    const date = strictBusinessDate(entry.date, `${entryField}.date`);
    if (date < forecastStartDate || date > forecastEndDate) {
      throw new Error(`${entryField}.date must be inside forecast range`);
    }
    if (seenDates.has(date)) throw new Error(`duplicate daily date: ${date}`);
    seenDates.add(date);

    return {
      date,
      closingBalance: finiteMoney(entry.closingBalance, `${entryField}.closingBalance`)
    };
  });

  daily.sort((left, right) => compareText(left.date, right.date));
  return daily;
}

function normalizeScenarios(value, forecastStartDate, forecastEndDate) {
  if (!Array.isArray(value)) throw new Error('scenarios must be an array');
  if (value.length === 0) throw new Error('scenarios must not be empty');

  const seenNames = new Set();
  const scenarios = value.map((scenario, index) => {
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
      throw new Error(`scenarios[${index}] must be an object`);
    }

    const name = requiredText(scenario.name, `scenarios[${index}].name`).toLowerCase();
    if (seenNames.has(name)) throw new Error(`duplicate scenario name: ${name}`);
    seenNames.add(name);

    const minimumBalanceDate = strictBusinessDate(
      scenario.minimumBalanceDate,
      `scenarios[${index}].minimumBalanceDate`
    );
    if (minimumBalanceDate < forecastStartDate || minimumBalanceDate > forecastEndDate) {
      throw new Error(`scenarios[${index}].minimumBalanceDate must be inside forecast range`);
    }

    const normalized = {
      name,
      minimumBalance: finiteMoney(
        scenario.minimumBalance,
        `scenarios[${index}].minimumBalance`
      ),
      minimumBalanceDate,
      cashGap: nonNegativeMoney(
        scenario.cashGap,
        `scenarios[${index}].cashGap`
      ),
      requiredCollection: nonNegativeMoney(
        scenario.requiredCollection,
        `scenarios[${index}].requiredCollection`
      ),
      safeWithdrawal: nonNegativeMoney(
        scenario.safeWithdrawal,
        `scenarios[${index}].safeWithdrawal`
      )
    };

    if (Object.prototype.hasOwnProperty.call(scenario, 'daily')) {
      normalized.daily = normalizeDaily(
        scenario.daily,
        index,
        forecastStartDate,
        forecastEndDate
      );
    }

    return normalized;
  });

  scenarios.sort((left, right) => compareText(left.name, right.name));
  return scenarios;
}

function normalizeBusinessFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('input must be an object');
  }

  const forecastStartDate = strictBusinessDate(input.forecastStartDate, 'forecastStartDate');
  const forecastEndDate = strictBusinessDate(input.forecastEndDate, 'forecastEndDate');
  if (forecastStartDate > forecastEndDate) throw new Error('forecast range is invalid');

  return {
    snapshotId: requiredText(input.snapshotId, 'snapshotId'),
    generatedAt: isoTimestamp(input.generatedAt, 'generatedAt'),
    modelVersion: requiredText(input.modelVersion, 'modelVersion'),
    forecastStartDate,
    forecastEndDate,
    scenarios: normalizeScenarios(input.scenarios, forecastStartDate, forecastEndDate)
  };
}

function fingerprintOf(normalized) {
  return createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function createForecastSnapshot(input) {
  const normalized = normalizeBusinessFields(input);
  return deepFreeze({
    ...normalized,
    fingerprint: fingerprintOf(normalized)
  });
}

export function verifyForecastSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('snapshot must be an object');
  }

  const fingerprint = typeof snapshot.fingerprint === 'string'
    ? snapshot.fingerprint.trim().toLowerCase()
    : '';
  const normalized = normalizeBusinessFields(snapshot);
  const expected = fingerprintOf(normalized);

  if (!/^[a-f0-9]{64}$/.test(fingerprint) || fingerprint !== expected) {
    throw new Error('forecast snapshot fingerprint mismatch');
  }
  return true;
}
