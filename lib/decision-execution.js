const VERIFY_STATUSES = new Set(['Подтверждено', 'Нет эффекта', 'Не применимо']);

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function asNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('actualEffect must be a finite number');
  return number;
}

function eventBase(current, command, now) {
  return {
    ruleId: required(current.ruleId, 'ruleId'),
    at: now.toISOString(),
    actor: required(command.actor, 'actor'),
    plannedEffect: Number.isFinite(Number(current.plannedEffect)) ? Number(current.plannedEffect) : 0,
    actualEffect: asNumberOrNull(command.actualEffect),
    evidence: String(command.evidence ?? '').trim(),
    comment: String(command.comment ?? '').trim()
  };
}

export function applyDecisionAction(current, command, now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('now must be a valid Date');
  const action = required(command?.action, 'action');
  const executionStatus = required(current?.executionStatus, 'executionStatus');
  const timestamp = now.toISOString();
  const next = {
    ...current,
    actualEffect: current.actualEffect ?? null,
    result: String(current.result ?? ''),
    verificationStatus: String(current.verificationStatus || 'Не проверено'),
    startedAt: current.startedAt || null,
    completedAt: current.completedAt || null,
    lastCheckedAt: current.lastCheckedAt || null
  };
  const base = eventBase(current, command, now);

  if (action === 'start') {
    if (executionStatus !== 'Не начато') {
      throw new Error(`start requires execution status Не начато; got ${executionStatus}`);
    }
    next.executionStatus = 'В работе';
    next.startedAt = timestamp;
    return {
      next,
      event: { ...base, type: 'Взято в работу', before: executionStatus, after: next.executionStatus }
    };
  }

  if (action === 'complete') {
    if (executionStatus !== 'В работе') {
      throw new Error(`complete requires execution status В работе; got ${executionStatus}`);
    }
    next.executionStatus = 'Готово';
    next.completedAt = timestamp;
    next.result = String(command.result ?? '').trim();
    return {
      next,
      event: { ...base, type: 'Завершено', before: executionStatus, after: next.executionStatus, result: next.result }
    };
  }

  if (action === 'verify') {
    if (executionStatus !== 'Готово') {
      throw new Error(`verify requires execution status Готово; got ${executionStatus}`);
    }
    const verificationStatus = required(command.verificationStatus, 'verificationStatus');
    if (!VERIFY_STATUSES.has(verificationStatus)) {
      throw new Error(`unsupported verificationStatus: ${verificationStatus}`);
    }
    const actualEffect = asNumberOrNull(command.actualEffect);
    if (verificationStatus === 'Подтверждено' && actualEffect === null) {
      throw new Error('actualEffect is required when verificationStatus is Подтверждено');
    }
    next.verificationStatus = verificationStatus;
    next.actualEffect = actualEffect;
    next.lastCheckedAt = timestamp;
    return {
      next,
      event: {
        ...base,
        type: 'Проверено',
        before: executionStatus,
        after: executionStatus,
        verificationStatus,
        actualEffect
      }
    };
  }

  throw new Error(`unsupported action: ${action}`);
}
