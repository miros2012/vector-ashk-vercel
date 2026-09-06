import { verifyForecastSnapshot } from './forecast-snapshot-journal.js';

const MAPE_ZERO_ACTUAL_POLICY = 'exclude-zero-actual-and-report';

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function requiredText(value, field) {
  if (typeof value !== 'string') throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
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

function finiteMoney(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite`);
  }
  return normalizeZero(value);
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeActualBalances(value) {
  if (!Array.isArray(value)) throw new Error('actualBalances must be an array');
  if (value.length === 0) throw new Error('actualBalances must not be empty');

  const seenDates = new Set();
  const normalized = value.map((entry, index) => {
    const field = `actualBalances[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${field} must be an object`);
    }

    const date = strictBusinessDate(entry.date, `${field}.date`);
    if (seenDates.has(date)) throw new Error(`duplicate actual date: ${date}`);
    seenDates.add(date);

    return {
      date,
      closingBalance: finiteMoney(entry.closingBalance, `${field}.closingBalance`)
    };
  });

  normalized.sort((left, right) => compareText(left.date, right.date));
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function mean(values) {
  if (values.length === 0) return null;
  return normalizeZero(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function maximumAbsoluteErrorOf(observations) {
  if (observations.length === 0) return null;

  let maximum = observations[0];
  for (let index = 1; index < observations.length; index += 1) {
    const candidate = observations[index];
    if (candidate.absoluteError > maximum.absoluteError) maximum = candidate;
  }

  return {
    value: maximum.absoluteError,
    date: maximum.date
  };
}

export function measureForecastAccuracy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('input must be an object');
  }

  const minimumSampleThreshold = positiveInteger(
    input.minimumSampleThreshold,
    'minimumSampleThreshold'
  );
  const scenarioName = requiredText(input.scenarioName, 'scenarioName').toLowerCase();
  const actualBalances = normalizeActualBalances(input.actualBalances);

  verifyForecastSnapshot(input.forecastSnapshot);
  const forecastSnapshot = input.forecastSnapshot;
  const scenario = forecastSnapshot.scenarios.find(candidate => candidate.name === scenarioName);
  if (!scenario) throw new Error(`unknown scenario: ${scenarioName}`);
  if (!Array.isArray(scenario.daily) || scenario.daily.length === 0) {
    throw new Error(`scenario ${scenarioName} daily forecast horizon is required and must not be empty`);
  }

  const forecastByDate = new Map(
    scenario.daily.map(entry => [entry.date, entry.closingBalance])
  );
  const actualByDate = new Map(
    actualBalances.map(entry => [entry.date, entry.closingBalance])
  );

  const forecastDates = [...forecastByDate.keys()].sort(compareText);
  if (forecastDates.length === 0) throw new Error('forecast horizon must not be empty');
  const actualDates = [...actualByDate.keys()].sort(compareText);

  const missingActualDates = forecastDates.filter(date => !actualByDate.has(date));
  const missingForecastDates = actualDates.filter(date => !forecastByDate.has(date));
  const matchedDates = forecastDates.filter(date => actualByDate.has(date));

  const zeroActualDates = [];
  const matchedObservations = matchedDates.map(date => {
    const forecastBalance = forecastByDate.get(date);
    const actualBalance = actualByDate.get(date);
    const signedError = normalizeZero(forecastBalance - actualBalance);
    const absoluteError = Math.abs(signedError);

    let absolutePercentageError = null;
    if (actualBalance === 0) {
      zeroActualDates.push(date);
    } else {
      absolutePercentageError = normalizeZero(
        (absoluteError / Math.abs(actualBalance)) * 100
      );
    }

    return {
      date,
      forecastBalance,
      actualBalance,
      signedError,
      absoluteError,
      absolutePercentageError
    };
  });

  const absoluteErrors = matchedObservations.map(observation => observation.absoluteError);
  const signedErrors = matchedObservations.map(observation => observation.signedError);
  const percentageErrors = matchedObservations
    .map(observation => observation.absolutePercentageError)
    .filter(value => value !== null);

  const sampleCount = matchedObservations.length;
  const result = {
    snapshotId: forecastSnapshot.snapshotId,
    snapshotFingerprint: forecastSnapshot.fingerprint,
    generatedAt: forecastSnapshot.generatedAt,
    modelVersion: forecastSnapshot.modelVersion,
    forecastStartDate: forecastSnapshot.forecastStartDate,
    forecastEndDate: forecastSnapshot.forecastEndDate,
    scenarioName,
    minimumSampleThreshold,
    sampleCount,
    sampleThresholdMet: sampleCount >= minimumSampleThreshold,
    forecastObservationCount: forecastDates.length,
    actualObservationCount: actualDates.length,
    matchedObservations,
    meanAbsoluteError: mean(absoluteErrors),
    signedBias: mean(signedErrors),
    maximumAbsoluteError: maximumAbsoluteErrorOf(matchedObservations),
    meanAbsolutePercentageError: mean(percentageErrors),
    mapeSampleCount: percentageErrors.length,
    mapeZeroActualPolicy: MAPE_ZERO_ACTUAL_POLICY,
    zeroActualDates,
    coverageRatio: normalizeZero(sampleCount / forecastDates.length),
    missingActualDates,
    missingForecastDates
  };

  return deepFreeze(result);
}
