import { createHash } from 'node:crypto';

const ACTIONS = {
  'В работу': { action:'start' },
  'Готово': { action:'complete' },
  'Подтвердить эффект': { action:'verify', verificationStatus:'Подтверждено' },
  'Нет эффекта': { action:'verify', verificationStatus:'Нет эффекта' },
  'Не применимо': { action:'verify', verificationStatus:'Не применимо' }
};

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function finiteEffect(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('actualEffect must be a finite number');
  return number;
}

function requestId(payload) {
  const signature = JSON.stringify(payload);
  return `OAR-${createHash('sha256').update(signature).digest('hex').slice(0, 24)}`;
}

export function normalizeOwnerActionRequest(input = {}) {
  const requestedAction = String(input.requestedAction || '').trim();
  if (!requestedAction) return null;
  const mapping = ACTIONS[requestedAction];
  if (!mapping) throw new Error(`unsupported requestedAction: ${requestedAction}`);

  const ruleId = required(input.ruleId, 'ruleId');
  const expectedExecutionStatus = required(input.expectedExecutionStatus, 'expectedExecutionStatus');
  const actualEffect = finiteEffect(input.actualEffect);
  if (mapping.verificationStatus === 'Подтверждено' && actualEffect === null) {
    throw new Error('actualEffect is required for confirmed verification');
  }

  const command = {
    ruleId,
    action: mapping.action,
    expectedExecutionStatus,
    actor: 'Owner Dashboard',
    result: String(input.result || '').trim(),
    evidence: String(input.evidence || '').trim(),
    comment: String(input.comment || '').trim()
  };
  if (mapping.verificationStatus) command.verificationStatus = mapping.verificationStatus;
  if (mapping.action === 'verify') command.actualEffect = actualEffect;

  const signaturePayload = {
    ruleId: command.ruleId,
    action: command.action,
    expectedExecutionStatus: command.expectedExecutionStatus,
    result: command.result,
    evidence: command.evidence,
    verificationStatus: command.verificationStatus || null,
    actualEffect: command.actualEffect ?? null
  };
  command.requestId = requestId(signaturePayload);
  return command;
}
