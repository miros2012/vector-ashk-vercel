const CATEGORIES = new Set([
  'liquidity',
  'critical_obligation',
  'decision_effect_verification',
  'active_decision',
  'data_health',
  'sales_collection_deficit'
]);

const PRIORITY_RANK = new Map([
  ['critical', 0],
  ['high', 1],
  ['medium', 2],
  ['low', 3]
]);

const DATA_HEALTH_STATUSES = new Set(['OK', 'WARNING', 'BLOCKED']);
const MAX_ACTIONS = 3;

function requiredText(value, name) {
  if (typeof value !== 'string') throw new Error(`${name} is required`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function canonicalUtc(value, name) {
  const text = requiredText(value, name);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)) {
    throw new Error(`${name} must be a canonical UTC timestamp`);
  }
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== text) {
    throw new Error(`${name} must be a valid UTC timestamp`);
  }
  return text;
}

function normalizedAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('candidate amount must be a finite non-negative number');
  }
  return Object.is(value, -0) ? 0 : value;
}

function requiredBoolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`);
  return value;
}

function normalizeCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('candidate must be an object');
  }

  const id = requiredText(value.id, 'candidate id');
  const category = requiredText(value.category, 'candidate category');
  if (!CATEGORIES.has(category)) throw new Error(`unsupported candidate category: ${category}`);
  const priority = requiredText(value.priority, 'candidate priority');
  if (!PRIORITY_RANK.has(priority)) throw new Error(`unsupported candidate priority: ${priority}`);

  return {
    id,
    category,
    priority,
    deadline: canonicalUtc(value.deadline, 'candidate deadline'),
    amount: normalizedAmount(value.amount),
    responsible: requiredText(value.responsible, 'candidate responsible'),
    action: requiredText(value.action, 'candidate action'),
    blocking: requiredBoolean(value.blocking, 'candidate blocking'),
    financialExecution: requiredBoolean(value.financialExecution, 'candidate financialExecution')
  };
}

function sameFacts(left, right) {
  return left.id === right.id
    && left.category === right.category
    && left.priority === right.priority
    && left.deadline === right.deadline
    && left.amount === right.amount
    && left.responsible === right.responsible
    && left.action === right.action
    && left.blocking === right.blocking
    && left.financialExecution === right.financialExecution;
}

function stableIdCompare(left, right) {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function compareCandidates(left, right) {
  if (left.blocking !== right.blocking) return left.blocking ? -1 : 1;

  const priorityDifference = PRIORITY_RANK.get(left.priority) - PRIORITY_RANK.get(right.priority);
  if (priorityDifference !== 0) return priorityDifference;

  if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;

  const amountDifference = right.amount - left.amount;
  if (amountDifference !== 0) return amountDifference;

  const deadlineDifference = left.deadlineEpoch - right.deadlineEpoch;
  if (deadlineDifference !== 0) return deadlineDifference;

  return stableIdCompare(left, right);
}

function freezeAction(candidate, dataHealthStatus, asOfEpoch) {
  const financiallyBlocked = dataHealthStatus === 'BLOCKED' && candidate.financialExecution;
  const nonExecutableReasons = Object.freeze(financiallyBlocked ? ['DATA_HEALTH_BLOCKED'] : []);
  return Object.freeze({
    ...candidate,
    overdue: new Date(candidate.deadline).getTime() < asOfEpoch,
    executable: !financiallyBlocked,
    nonExecutableReasons
  });
}

export function buildOwnerActionAgenda(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('input must be an object');
  }

  const asOf = canonicalUtc(input.asOf, 'asOf');
  const dataHealthStatus = requiredText(input.dataHealthStatus, 'dataHealthStatus');
  if (!DATA_HEALTH_STATUSES.has(dataHealthStatus)) {
    throw new Error(`unsupported dataHealthStatus: ${dataHealthStatus}`);
  }
  if (!Array.isArray(input.candidates)) throw new Error('candidates must be an array');

  const byId = new Map();
  for (const rawCandidate of input.candidates) {
    const normalized = normalizeCandidate(rawCandidate);
    const existing = byId.get(normalized.id);
    if (existing) {
      if (!sameFacts(existing, normalized)) {
        throw new Error(`conflicting duplicate candidate id: ${normalized.id}`);
      }
      continue;
    }
    byId.set(normalized.id, normalized);
  }

  const asOfEpoch = new Date(asOf).getTime();
  const ranked = [...byId.values()].map((candidate) => ({
    ...candidate,
    overdue: new Date(candidate.deadline).getTime() < asOfEpoch,
    deadlineEpoch: new Date(candidate.deadline).getTime()
  }));
  ranked.sort(compareCandidates);

  const actions = Object.freeze(ranked.slice(0, MAX_ACTIONS).map(({ deadlineEpoch, overdue, ...candidate }) => (
    freezeAction(candidate, dataHealthStatus, asOfEpoch)
  )));
  const blockedFinancialActions = actions.reduce(
    (count, action) => count + (action.financialExecution && !action.executable ? 1 : 0),
    0
  );

  return Object.freeze({
    asOf,
    dataHealthStatus,
    totalCandidates: byId.size,
    selectedCount: actions.length,
    blockedFinancialActions,
    actions
  });
}
