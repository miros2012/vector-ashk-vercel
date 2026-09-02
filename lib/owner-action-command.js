const ACTIONS = new Map([
  ['В работу', { action: 'start' }],
  ['Готово', { action: 'complete' }],
  ['Подтвердить эффект', { action: 'verify', verificationStatus: 'Подтверждено' }],
  ['Нет эффекта', { action: 'verify', verificationStatus: 'Нет эффекта' }],
  ['Не применимо', { action: 'verify', verificationStatus: 'Не применимо' }]
]);

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('actualEffect must be a finite number');
  return number;
}

export function normalizeOwnerActionCommand(row = {}) {
  if (String(row.commandStatus || '').trim() !== 'READY') {
    throw new Error('commandStatus must be READY');
  }
  const ownerAction = required(row.action, 'action');
  const mapped = ACTIONS.get(ownerAction);
  if (!mapped) throw new Error(`unsupported owner action: ${ownerAction}`);

  return {
    requestId: required(row.requestId, 'requestId'),
    ruleId: required(row.ruleId, 'ruleId'),
    action: mapped.action,
    expectedExecutionStatus: required(row.expectedExecutionStatus, 'expectedExecutionStatus'),
    actor: required(row.actor, 'actor'),
    result: String(row.result ?? '').trim(),
    verificationStatus: mapped.verificationStatus || String(row.verificationStatus ?? '').trim(),
    actualEffect: numberOrNull(row.actualEffect),
    evidence: String(row.evidence ?? '').trim()
  };
}
