const OPERATING_RESERVE_UNDEFINED = 'OPERATING_RESERVE_UNDEFINED';
const BUSINESS_TIME_ZONE = 'Asia/Yekaterinburg';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function normalizeFiniteNumber(value, name, { nonNegative = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  if (nonNegative && normalized < 0) {
    throw new Error(`${name} must be non-negative`);
  }
  return normalized;
}

function normalizeTimestamp(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a valid ISO timestamp`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${name} must be a valid ISO timestamp`);
  }
  return {
    timestamp,
    iso: new Date(timestamp).toISOString()
  };
}

function normalizeBusinessDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('snapshot businessDate must be YYYY-MM-DD');
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error('snapshot businessDate must be YYYY-MM-DD');
  }
  return value;
}

function currentBusinessDate(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(timestamp));
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('baseUrl is required');
  }
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('baseUrl must be a valid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('baseUrl must use https');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('baseUrl must not include credentials, query, or hash');
  }
  return parsed.origin;
}

function normalizeKey(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error('key is required');
  return normalized;
}

function normalizePolicyBlockers(value) {
  if (!Array.isArray(value)) {
    throw new Error('policy blockers must be unique non-empty strings');
  }
  const blockers = value.map((entry) => (typeof entry === 'string' ? entry.trim() : ''));
  if (blockers.some((entry) => !entry) || new Set(blockers).size !== blockers.length) {
    throw new Error('policy blockers must be unique non-empty strings');
  }
  return blockers;
}

function normalizeOperatingReservePolicy(value, blockers) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('operating reserve policy is required');
  }
  if (typeof value.defined !== 'boolean') {
    throw new Error('operating reserve defined flag must be boolean');
  }

  const hasUndefinedBlocker = blockers.includes(OPERATING_RESERVE_UNDEFINED);
  if (!value.defined) {
    if (value.amount !== null) {
      throw new Error('undefined operating reserve must not include an amount');
    }
    if (!hasUndefinedBlocker) {
      throw new Error('operating reserve policy conflicts with blockers');
    }
    return { defined: false };
  }

  normalizeFiniteNumber(value.amount, 'operating reserve amount', { nonNegative: true });
  if (hasUndefinedBlocker) {
    throw new Error('operating reserve policy conflicts with blockers');
  }
  return { defined: true };
}

function normalizeRequiredBlocker(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('requiredPolicyBlocker must be a non-empty string');
  }
  return value.trim();
}

function getCacheControl(response) {
  const value = response?.headers?.get?.('cache-control');
  return typeof value === 'string' ? value : '';
}

export async function verifyOwnerPackageProduction({
  baseUrl,
  key,
  fetchImpl,
  now,
  maxAgeMs,
  expectedSafeWithdrawal,
  requiredPolicyBlocker
} = {}) {
  const origin = normalizeBaseUrl(baseUrl);
  const normalizedKey = normalizeKey(key);
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');

  const nowValue = normalizeTimestamp(now, 'now');
  const freshnessLimit = normalizeFiniteNumber(maxAgeMs, 'maxAgeMs', { nonNegative: true });
  const expectedWithdrawal = expectedSafeWithdrawal === undefined
    ? undefined
    : normalizeFiniteNumber(expectedSafeWithdrawal, 'expectedSafeWithdrawal', { nonNegative: true });
  const requiredBlocker = normalizeRequiredBlocker(requiredPolicyBlocker);

  const response = await fetchImpl(`${origin}/api/owner-package`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-vector-key': normalizedKey
    },
    redirect: 'error',
    cache: 'no-store'
  });

  if (!response || response.status !== 200) {
    throw new Error(`unexpected HTTP status: ${response?.status ?? 'unknown'}`);
  }

  const cacheControl = getCacheControl(response);
  if (!/(?:^|,)\s*no-store(?:\s*(?:,|$)|\s*=)/i.test(cacheControl)) {
    throw new Error('Cache-Control must include no-store');
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('response body must be valid JSON');
  }
  if (!body || typeof body !== 'object' || body.ok !== true || !body.package || typeof body.package !== 'object') {
    throw new Error('package is required');
  }

  const ownerPackage = body.package;
  const withdrawal = normalizeFiniteNumber(
    ownerPackage?.withdrawal?.safeWithdrawal,
    'package.withdrawal.safeWithdrawal',
    { nonNegative: true }
  );
  const summaryWithdrawal = normalizeFiniteNumber(
    ownerPackage?.summary?.safeWithdrawal,
    'package.summary.safeWithdrawal',
    { nonNegative: true }
  );
  if (withdrawal !== summaryWithdrawal) {
    throw new Error('safeWithdrawal facts conflict');
  }
  if (expectedWithdrawal !== undefined && withdrawal !== expectedWithdrawal) {
    throw new Error('safeWithdrawal does not match expectation');
  }

  const policyBlockers = normalizePolicyBlockers(ownerPackage?.policy?.blockers);
  if (requiredBlocker && !policyBlockers.includes(requiredBlocker)) {
    throw new Error('required policy blocker is missing');
  }
  const operatingReserve = normalizeOperatingReservePolicy(
    ownerPackage?.policy?.operatingReserve,
    policyBlockers
  );

  if (!ownerPackage.snapshot || typeof ownerPackage.snapshot !== 'object') {
    throw new Error('snapshot is required');
  }
  const businessDate = normalizeBusinessDate(ownerPackage.snapshot.businessDate);
  if (businessDate !== currentBusinessDate(nowValue.timestamp)) {
    throw new Error('snapshot businessDate does not match current business date');
  }
  const generatedAt = normalizeTimestamp(ownerPackage.snapshot.generatedAt, 'snapshot generatedAt');
  const ageMs = nowValue.timestamp - generatedAt.timestamp;
  if (ageMs < 0) throw new Error('snapshot is from the future');
  if (ageMs > freshnessLimit) throw new Error('snapshot is stale');

  return deepFreeze({
    ok: true,
    status: response.status,
    cacheControl,
    businessDate,
    generatedAt: generatedAt.iso,
    ageMs,
    safeWithdrawal: withdrawal,
    operatingReserveDefined: operatingReserve.defined,
    policyBlockers: [...policyBlockers]
  });
}
