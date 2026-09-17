function normalizedStatus(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isUnconfirmedObligationStatus(status) {
  return normalizedStatus(status).startsWith('требует');
}

export function isClosedObligationStatus(status) {
  const normalized = normalizedStatus(status);
  if (!normalized) return false;
  if (normalized.includes('частично') || normalized.includes('не оплачен')) return false;
  return normalized.includes('оплачен') || normalized.includes('закрыт');
}
