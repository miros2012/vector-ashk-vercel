function text(value) {
  return String(value ?? '').trim();
}

function finiteOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueByKey(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = text(row?.[14]);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

export function evaluateTochkaDdsCoverage({
  tochkaRows = [],
  ddsSourceRows = [],
  businessDateSerial
} = {}) {
  const targetDate = finiteOrNull(businessDateSerial);
  if (targetDate === null) throw new Error('businessDateSerial is required');

  const eligible = uniqueByKey((Array.isArray(tochkaRows) ? tochkaRows : []).filter((row) => {
    const date = finiteOrNull(row?.[0]);
    const isInternal = text(row?.[6]).toLowerCase() === 'да';
    const key = text(row?.[14]);
    return date !== null && Math.trunc(date) === Math.trunc(targetDate) && !isInternal && Boolean(key);
  }));

  const ddsText = (Array.isArray(ddsSourceRows) ? ddsSourceRows : [])
    .flatMap((row) => Array.isArray(row) ? row : [row])
    .map(text)
    .filter(Boolean)
    .join('\n');

  const missing = eligible.filter((row) => !ddsText.includes(text(row?.[14])));
  const missingOutflow = missing.reduce((sum, row) => {
    const signed = finiteOrNull(row?.[5]) ?? 0;
    return signed < 0 ? sum + Math.abs(signed) : sum;
  }, 0);
  const missingInflow = missing.reduce((sum, row) => {
    const signed = finiteOrNull(row?.[5]) ?? 0;
    return signed > 0 ? sum + signed : sum;
  }, 0);

  return {
    ok: missing.length === 0,
    eligibleCount: eligible.length,
    coveredCount: eligible.length - missing.length,
    missingCount: missing.length,
    missingOutflow,
    missingInflow,
    missingKeys: missing.map((row) => text(row?.[14])).slice(0, 20)
  };
}
