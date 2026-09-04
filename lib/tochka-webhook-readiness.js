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

export function evaluateTochkaWebhookReadiness(rows = []) {
  const operationRow = findControlRow(rows, 'Точка операции');
  const ddsRow = findControlRow(rows, 'Точка → ДДС');
  const operationStatus = operationRow ? text(operationRow?.[6]).toUpperCase() : '';
  const missingDdsCount = ddsRow ? finiteOrNull(ddsRow?.[2]) : null;
  const reasons = [];

  if (!operationRow || !operationStatus) {
    reasons.push('operations_status_missing');
  } else if (operationStatus !== 'OK') {
    reasons.push('operations_not_fresh');
  }

  if (!ddsRow || missingDdsCount === null) {
    reasons.push('dds_coverage_missing');
  } else if (missingDdsCount !== 0) {
    reasons.push('dds_incomplete');
  }

  return {
    ok: reasons.length === 0,
    operationStatus: operationStatus || null,
    missingDdsCount,
    reasons
  };
}
