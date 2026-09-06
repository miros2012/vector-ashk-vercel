const SUPPORTED_STATUSES = new Set(['OK', 'WARNING', 'BLOCKED']);
const DAY_MS = 24 * 60 * 60 * 1000;

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

function stableTextCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeReasons(value, index) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`records[${index}].reasons must be an array`);

  const seen = new Set();
  const reasons = [];
  for (const rawReason of value) {
    if (typeof rawReason !== 'string' || !rawReason.trim()) {
      throw new Error(`records[${index}].reason must be non-empty`);
    }
    const reason = rawReason.trim();
    if (!seen.has(reason)) {
      seen.add(reason);
      reasons.push(reason);
    }
  }
  reasons.sort(stableTextCompare);
  return reasons;
}

function normalizeRecord(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`records[${index}] must be an object`);
  }
  const businessDate = strictBusinessDate(record.businessDate, `records[${index}].businessDate`);
  if (typeof record.status !== 'string' || !record.status.trim()) {
    throw new Error(`records[${index}].status is required`);
  }
  const status = record.status.trim().toUpperCase();
  if (!SUPPORTED_STATUSES.has(status)) {
    throw new Error(`unsupported Data Health status: ${status}`);
  }
  return {
    businessDate,
    status,
    reasons: normalizeReasons(record.reasons, index)
  };
}

function dateToMs(value) {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function nextDate(value) {
  return new Date(dateToMs(value) + DAY_MS).toISOString().slice(0, 10);
}

function listMissingDates(records) {
  if (records.length < 2) return [];
  const present = new Set(records.map(record => record.businessDate));
  const missing = [];
  for (let date = records[0].businessDate; date < records.at(-1).businessDate; date = nextDate(date)) {
    const candidate = nextDate(date);
    if (candidate < records.at(-1).businessDate && !present.has(candidate)) missing.push(candidate);
  }
  return missing;
}

function calculateLongestStreak(records) {
  let longest = 0;
  let current = 0;
  let previousDate = null;
  for (const record of records) {
    const consecutive = previousDate !== null && dateToMs(record.businessDate) - dateToMs(previousDate) === DAY_MS;
    if (record.status === 'OK') {
      current = consecutive ? current + 1 : 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
    previousDate = record.businessDate;
  }
  return longest;
}

function calculateCurrentStreak(records, asOfDate) {
  if (!records.length || records.at(-1).businessDate !== asOfDate) return 0;
  let streak = 0;
  let expectedDate = asOfDate;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record.businessDate !== expectedDate || record.status !== 'OK') break;
    streak += 1;
    expectedDate = new Date(dateToMs(expectedDate) - DAY_MS).toISOString().slice(0, 10);
  }
  return streak;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function buildDataHealthStreak(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('input must be an object');
  }
  if (!Array.isArray(input.records) || input.records.length === 0) {
    throw new Error('at least one record is required');
  }
  const asOfDate = strictBusinessDate(input.asOfDate, 'asOfDate');
  if (!Number.isInteger(input.requiredHealthyStreak) || input.requiredHealthyStreak <= 0) {
    throw new Error('requiredHealthyStreak must be a positive integer');
  }

  const seenDates = new Set();
  const records = input.records.map((record, index) => {
    const normalized = normalizeRecord(record, index);
    if (seenDates.has(normalized.businessDate)) {
      throw new Error(`duplicate businessDate: ${normalized.businessDate}`);
    }
    seenDates.add(normalized.businessDate);
    return normalized;
  }).sort((left, right) => stableTextCompare(left.businessDate, right.businessDate));

  const historicalRecords = records.filter(record => record.businessDate <= asOfDate);
  const futureDates = records
    .filter(record => record.businessDate > asOfDate)
    .map(record => record.businessDate);
  if (historicalRecords.length === 0) {
    throw new Error('at least one record on or before asOfDate is required');
  }

  const unhealthyRecords = historicalRecords.filter(record => record.status !== 'OK');
  const lastUnhealthy = unhealthyRecords.at(-1) ?? null;
  const currentStreak = calculateCurrentStreak(historicalRecords, asOfDate);
  const result = {
    asOfDate,
    requiredHealthyStreak: input.requiredHealthyStreak,
    currentStreak,
    longestStreak: calculateLongestStreak(historicalRecords),
    thresholdReached: currentStreak >= input.requiredHealthyStreak,
    lastUnhealthyDate: lastUnhealthy?.businessDate ?? null,
    lastUnhealthyReasons: lastUnhealthy ? [...lastUnhealthy.reasons] : [],
    missingDates: listMissingDates(historicalRecords),
    futureDates,
    records
  };

  return deepFreeze(result);
}
