function text(value) {
  return String(value ?? '').trim();
}

function finiteOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function findControlRow(rows, label) {
  return (Array.isArray(rows) ? rows : []).find((row) => text(row?.[0]) === label) || null;
}

const MAX_CANDIDATE_OPERATION_SKEW_MS = 15 * 60 * 1000;

function latestCandidateTimestampMs(normalized) {
  const timestamps = (Array.isArray(normalized?.funds) ? normalized.funds : [])
    .map((row) => Date.parse(String(row?.dateTime || '')))
    .filter(Number.isFinite);
  return timestamps.length ? Math.max(...timestamps) : null;
}

function roundedMinutes(milliseconds) {
  return Math.round((milliseconds / 60000) * 1000) / 1000;
}

export function evaluateTochkaWebhookReadiness(rows = []) {
  const operationRow = findControlRow(rows, 'Точка операции');
  const ddsRow = findControlRow(rows, 'Точка → ДДС');
  const operationStatus = operationRow ? text(operationRow?.[6]).toUpperCase() : '';
  const operationAgeHours = operationRow ? finiteOrNull(operationRow?.[3]) : null;
  const missingDdsCount = ddsRow ? finiteOrNull(ddsRow?.[2]) : null;
  const reasons = [];
  let mirrorReady = true;
  let ddsReady = true;

  if (!operationRow || !operationStatus) {
    reasons.push('operations_status_missing');
    mirrorReady = false;
  } else if (operationStatus !== 'OK') {
    reasons.push('operations_not_fresh');
    mirrorReady = false;
  }

  if (!ddsRow || missingDdsCount === null) {
    reasons.push('dds_coverage_missing');
    ddsReady = false;
  } else if (missingDdsCount !== 0) {
    reasons.push('dds_incomplete');
    ddsReady = false;
  }

  const accountingReady = mirrorReady && ddsReady;
  return {
    ok: accountingReady,
    mirrorReady,
    accountingReady,
    operationStatus: operationStatus || null,
    operationAgeHours,
    missingDdsCount,
    reasons
  };
}

export function evaluateCandidateBalanceReadiness({
  readiness = {},
  normalized = {},
  nowMs = Date.now(),
  maxSkewMs = MAX_CANDIDATE_OPERATION_SKEW_MS
} = {}) {
  const operationAgeHours = finiteOrNull(readiness?.operationAgeHours);
  if (operationAgeHours === null) {
    return {
      ok: false,
      reason: 'operation_age_missing',
      skewMinutes: null,
      candidateTimestamp: null
    };
  }
  if (operationAgeHours < 0) {
    return {
      ok: false,
      reason: 'operation_age_invalid',
      skewMinutes: null,
      candidateTimestamp: null
    };
  }

  const candidateTimestampMs = latestCandidateTimestampMs(normalized);
  if (candidateTimestampMs === null) {
    return {
      ok: false,
      reason: 'candidate_balance_timestamp_missing',
      skewMinutes: null,
      candidateTimestamp: null
    };
  }

  const currentMs = finiteOrNull(nowMs);
  if (currentMs === null) {
    return {
      ok: false,
      reason: 'clock_invalid',
      skewMinutes: null,
      candidateTimestamp: new Date(candidateTimestampMs).toISOString()
    };
  }

  const allowedSkewMs = finiteOrNull(maxSkewMs);
  if (allowedSkewMs === null || allowedSkewMs < 0) {
    return {
      ok: false,
      reason: 'max_skew_invalid',
      skewMinutes: null,
      candidateTimestamp: new Date(candidateTimestampMs).toISOString()
    };
  }

  const candidateAgeMs = currentMs - candidateTimestampMs;
  const skewMs = operationAgeHours * 60 * 60 * 1000 - candidateAgeMs;
  const result = {
    ok: skewMs <= allowedSkewMs,
    reason: skewMs <= allowedSkewMs ? null : 'candidate_balance_ahead_of_operations',
    skewMinutes: roundedMinutes(skewMs),
    candidateTimestamp: new Date(candidateTimestampMs).toISOString()
  };
  return result;
}
