const CONFIRMED_TYPES = new Set([
  'ADVANCE',
  'OFFICIAL_PAYMENT',
  'STATUTORY_DEDUCTION',
  'OTHER_CONFIRMED_INDIVIDUAL'
]);

function normalizeText(value) {
  return String(value ?? '')
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function positiveAmount(value) {
  const amount = Math.abs(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new TypeError(`Invalid payroll evidence amount: ${value}`);
  }
  return amount;
}

function vehicleType(row) {
  const article = normalizeText(row.article);
  const text = `${article} ${normalizeText(row.counterparty)} ${normalizeText(row.description)}`;
  if (article.includes('топлив') || /\bгсм\b/.test(text)) return 'FUEL';
  if (article.includes('лизинг') || text.includes('лизинг')) return 'LEASING';
  if (article.includes('автомоб') || article.includes('ремонт авто') || article.includes('аренд') && text.includes('авто')) {
    return 'VEHICLE_COST';
  }
  return null;
}

function resolveMasterKey(row, aliases) {
  if (row.masterKey) return String(row.masterKey);

  const haystack = normalizeText(`${row.counterparty ?? ''} ${row.description ?? ''}`);
  const candidates = Object.entries(aliases ?? {})
    .map(([alias, masterKey]) => [normalizeText(alias), masterKey])
    .filter(([alias]) => alias)
    .sort((a, b) => b[0].length - a[0].length);

  const found = candidates.find(([alias]) => haystack.includes(alias));
  return found ? String(found[1]) : null;
}

function classifyPayrollType(row) {
  if (row.evidenceType) {
    const explicit = String(row.evidenceType);
    if (!CONFIRMED_TYPES.has(explicit)) {
      throw new TypeError(`Unsupported payroll evidence type: ${explicit}`);
    }
    return explicit;
  }

  const text = normalizeText(`${row.counterparty ?? ''} ${row.description ?? ''}`);
  if (text.includes('аванс')) return 'ADVANCE';
  if (
    text.includes('уфк') ||
    text.includes('фссп') ||
    text.includes('пристав') ||
    text.includes('алимент') ||
    text.includes('взыскан') ||
    text.includes('исполнительн') ||
    text.includes('задолженност')
  ) {
    return 'STATUTORY_DEDUCTION';
  }
  if (text.includes('заработн') || text.includes('зарплат') || /\bзп\b/.test(text)) {
    return 'OFFICIAL_PAYMENT';
  }
  return null;
}

function blockedItem(row, type, reason) {
  return {
    type,
    amount: positiveAmount(row.amount),
    sourceId: String(row.sourceId ?? ''),
    reason
  };
}

export function normalizePayrollEvidence(rows, aliases = {}) {
  if (!Array.isArray(rows)) {
    throw new TypeError('rows must be an array');
  }

  const confirmed = [];
  const blocked = [];

  for (const row of rows) {
    const amount = positiveAmount(row.amount);
    const sourceId = String(row.sourceId ?? '');
    const masterKey = resolveMasterKey(row, aliases);
    const vehicle = vehicleType(row);

    if (vehicle) {
      if (!masterKey || !row.masterKey) {
        blocked.push(blockedItem(row, vehicle, 'NO_MASTER_ALLOCATION'));
        continue;
      }
      confirmed.push({
        masterKey,
        type: 'OTHER_CONFIRMED_INDIVIDUAL',
        amount,
        sourceId,
        status: 'CONFIRMED'
      });
      continue;
    }

    const type = classifyPayrollType(row);
    if (!type || !masterKey) {
      blocked.push(blockedItem(row, type ?? 'PAYROLL_UNALLOCATED', 'NO_MASTER_ALLOCATION'));
      continue;
    }

    confirmed.push({ masterKey, type, amount, sourceId, status: 'CONFIRMED' });
  }

  return { confirmed, blocked };
}
