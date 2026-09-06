import { createHash } from 'node:crypto';

const DATA_HEALTH_STATUSES = new Set(['OK', 'WARNING', 'BLOCKED']);
const PRIORITY_RANK = new Map([
  ['critical', 0],
  ['high', 1],
  ['medium', 2],
  ['low', 3]
]);
const MAX_ACTIONS = 3;
const MONEY_FIELDS = Object.freeze([
  'availableCash',
  'cashGap',
  'safeWithdrawal',
  'salesPlanToDate',
  'salesFact',
  'receivables',
  'openObligations',
  'unconfirmedObligations',
  'drivingFundReserve',
  'drivingFundDeficit'
]);

function requiredText(value, field) {
  if (typeof value !== 'string') throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function nonNegativeMoney(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite`);
  }
  const normalized = normalizeZero(value);
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

function stableTextCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeDataHealth(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('dataHealth must be an object');
  }
  const status = requiredText(value.status, 'dataHealth.status').toUpperCase();
  if (!DATA_HEALTH_STATUSES.has(status)) {
    throw new Error(`unsupported Data Health status: ${status}`);
  }
  if (!Array.isArray(value.reasons)) throw new Error('dataHealth.reasons must be an array');

  const reasons = [];
  const seen = new Set();
  for (let index = 0; index < value.reasons.length; index += 1) {
    const reason = requiredText(value.reasons[index], `dataHealth.reasons[${index}]`);
    if (!seen.has(reason)) {
      seen.add(reason);
      reasons.push(reason);
    }
  }
  reasons.sort(stableTextCompare);
  return { status, reasons };
}

function normalizeAction(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`actions[${index}] must be an object`);
  }
  const id = requiredText(value.id, `actions[${index}].id`);
  const priority = requiredText(value.priority, `actions[${index}].priority`).toLowerCase();
  if (!PRIORITY_RANK.has(priority)) {
    throw new Error(`unsupported action priority: ${priority}`);
  }
  return {
    id,
    priority,
    responsible: requiredText(value.responsible, `actions[${index}].responsible`),
    deadline: isoTimestamp(value.deadline, `actions[${index}].deadline`),
    riskEffectAmount: nonNegativeMoney(
      value.riskEffectAmount,
      `actions[${index}].riskEffectAmount`
    )
  };
}

function compareActions(left, right) {
  const priorityDifference = PRIORITY_RANK.get(left.priority) - PRIORITY_RANK.get(right.priority);
  if (priorityDifference !== 0) return priorityDifference;

  const deadlineDifference = new Date(left.deadline).getTime() - new Date(right.deadline).getTime();
  if (deadlineDifference !== 0) return deadlineDifference;

  const amountDifference = right.riskEffectAmount - left.riskEffectAmount;
  if (amountDifference !== 0) return amountDifference;

  return stableTextCompare(left.id, right.id);
}

function normalizeActions(value) {
  if (!Array.isArray(value)) throw new Error('actions must be an array');
  if (value.length > MAX_ACTIONS) throw new Error('at most three actions are allowed');

  const seenIds = new Set();
  const actions = value.map((action, index) => {
    const normalized = normalizeAction(action, index);
    if (seenIds.has(normalized.id)) throw new Error(`duplicate action id: ${normalized.id}`);
    seenIds.add(normalized.id);
    return normalized;
  });
  actions.sort(compareActions);
  return actions;
}

function normalizeBusinessFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('input must be an object');
  }

  const normalized = {
    snapshotId: requiredText(input.snapshotId, 'snapshotId'),
    businessDate: strictBusinessDate(input.businessDate, 'businessDate'),
    generatedAt: isoTimestamp(input.generatedAt, 'generatedAt'),
    modelVersion: requiredText(input.modelVersion, 'modelVersion')
  };

  for (const field of MONEY_FIELDS) {
    normalized[field] = nonNegativeMoney(input[field], field);
  }

  normalized.dataHealth = normalizeDataHealth(input.dataHealth);
  normalized.actions = normalizeActions(input.actions);
  return normalized;
}

function fingerprintOf(normalized) {
  return createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function createOwnerDashboardSnapshot(input) {
  const normalized = normalizeBusinessFields(input);
  return deepFreeze({
    ...normalized,
    fingerprint: fingerprintOf(normalized)
  });
}

export function verifyOwnerDashboardSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('snapshot must be an object');
  }
  const fingerprint = typeof snapshot.fingerprint === 'string'
    ? snapshot.fingerprint.trim().toLowerCase()
    : '';
  const normalized = normalizeBusinessFields(snapshot);
  const expected = fingerprintOf(normalized);
  if (!/^[a-f0-9]{64}$/.test(fingerprint) || fingerprint !== expected) {
    throw new Error('owner dashboard snapshot fingerprint mismatch');
  }
  return true;
}
