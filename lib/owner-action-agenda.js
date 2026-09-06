const SUPPORTED_CATEGORIES = new Set([
  'LIQUIDITY',
  'CRITICAL_OBLIGATION',
  'DECISION_VERIFICATION',
  'ACTIVE_DECISION',
  'DATA_HEALTH',
  'SALES_COLLECTION'
]);

const PRIORITY_RANK = Object.freeze({
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3
});

const SUPPORTED_HEALTH_STATUSES = new Set(['OK', 'BLOCKED']);
const CANDIDATE_FIELDS = Object.freeze([
  'id',
  'category',
  'priority',
  'deadline',
  'amount',
  'responsible',
  'action',
  'blocking',
  'financialExecution'
]);

function text(value) {
  return String(value ?? '').trim();
}

function requiredText(value, field) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function normalizedTimestamp(value, field) {
  const source = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(source)) {
    throw new Error(`${field} is invalid`);
  }
  const parsed = new Date(source);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
}

function normalizedAmount(value) {
  if (!Number.isFinite(value)) throw new Error('candidate amount must be finite');
  if (value < 0) throw new Error('candidate amount must be non-negative');
  return Object.is(value, -0) ? 0 : value;
}

function requiredBoolean(value, field) {
  if (typeof value !== 'boolean') throw new Error(`${field} must be boolean`);
  return value;
}

function normalizeCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('candidate must be an object');
  }

  const id = requiredText(value.id, 'candidate id');
  const category = requiredText(value.category, 'candidate category');
  if (!SUPPORTED_CATEGORIES.has(category)) throw new Error('candidate category is unsupported');

  const priority = requiredText(value.priority, 'candidate priority');
  if (!(priority in PRIORITY_RANK)) throw new Error('candidate priority is unsupported');

  return {
    id,
    category,
    priority,
    deadline: normalizedTimestamp(value.deadline, 'candidate deadline'),
    amount: normalizedAmount(value.amount),
    responsible: requiredText(value.responsible, 'candidate responsible'),
    action: requiredText(value.action, 'candidate action'),
    blocking: requiredBoolean(value.blocking, 'candidate blocking'),
    financialExecution: requiredBoolean(value.financialExecution, 'candidate financialExecution')
  };
}

function candidatesEqual(left, right) {
  return CANDIDATE_FIELDS.every(field => left[field] === right[field]);
}

function lexicalCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareActions(left, right) {
  if (left.blocking !== right.blocking) return left.blocking ? -1 : 1;

  const priorityDifference = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (priorityDifference !== 0) return priorityDifference;

  if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
  if (left.amount !== right.amount) return right.amount - left.amount;

  const deadlineDifference = Date.parse(left.deadline) - Date.parse(right.deadline);
  if (deadlineDifference !== 0) return deadlineDifference;

  return lexicalCompare(left.id, right.id);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function buildOwnerActionAgenda(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('input is required');
  }

  const asOf = normalizedTimestamp(input.asOf, 'asOf');
  const dataHealthStatus = requiredText(input.dataHealthStatus, 'dataHealthStatus');
  if (!SUPPORTED_HEALTH_STATUSES.has(dataHealthStatus)) {
    throw new Error('dataHealthStatus is unsupported');
  }
  if (!Array.isArray(input.candidates)) throw new Error('candidates must be an array');

  const uniqueById = new Map();
  for (const rawCandidate of input.candidates) {
    const normalized = normalizeCandidate(rawCandidate);
    const existing = uniqueById.get(normalized.id);
    if (existing && !candidatesEqual(existing, normalized)) {
      throw new Error(`conflicting duplicate candidate: ${normalized.id}`);
    }
    if (!existing) uniqueById.set(normalized.id, normalized);
  }

  const blocked = dataHealthStatus === 'BLOCKED';
  const asOfMs = Date.parse(asOf);
  const actions = [...uniqueById.values()]
    .map(item => {
      const executable = !(blocked && item.financialExecution);
      return {
        ...item,
        overdue: Date.parse(item.deadline) < asOfMs,
        executable,
        nonExecutableReason: executable ? null : 'DATA_HEALTH_BLOCKED'
      };
    })
    .sort(compareActions)
    .slice(0, 3)
    .map((item, index) => ({ rank: index + 1, ...item }));

  return deepFreeze({
    asOf,
    dataHealthStatus,
    blocked,
    actions
  });
}
