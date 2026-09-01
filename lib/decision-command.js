import { applyDecisionAction } from './decision-execution.js';

function commandError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}

export async function executeDecisionCommand({
  command = {},
  getDecision,
  hasEvent = async () => false,
  writeDecision,
  appendEvent,
  now = () => new Date()
}) {
  const ruleId = String(command.ruleId || '').trim();
  if (!ruleId) throw commandError(400, 'ruleId is required');

  const requestId = String(command.requestId || '').trim();
  const expectedExecutionStatus = String(command.expectedExecutionStatus || '').trim();
  const current = await getDecision(ruleId);
  if (!current) throw commandError(404, 'decision not found', { ruleId });

  if (requestId && await hasEvent(requestId)) {
    return {
      ok: true,
      idempotent: true,
      requestId,
      ruleId,
      action: String(command.action || ''),
      executionStatus: current.executionStatus,
      verificationStatus: current.verificationStatus,
      actualEffect: current.actualEffect,
      eventType: null,
      eventAt: null
    };
  }

  if (expectedExecutionStatus && expectedExecutionStatus !== String(current.executionStatus || '').trim()) {
    throw commandError(409, 'stale execution state', {
      ruleId,
      expectedExecutionStatus,
      currentExecutionStatus: current.executionStatus
    });
  }

  if (String(current.ruleStatus || '').trim() !== 'Активно') {
    throw commandError(409, 'inactive financial rule cannot be executed', { ruleId });
  }

  let applied;
  try {
    applied = applyDecisionAction(current, command, now());
  } catch (error) {
    throw commandError(400, String(error?.message || error), { ruleId });
  }

  const event = requestId ? { ...applied.event, eventId: requestId } : applied.event;
  await writeDecision(ruleId, applied.next);
  await appendEvent(event);

  return {
    ok: true,
    idempotent: false,
    requestId: requestId || null,
    ruleId,
    action: String(command.action || ''),
    executionStatus: applied.next.executionStatus,
    verificationStatus: applied.next.verificationStatus,
    actualEffect: applied.next.actualEffect,
    eventType: applied.event.type,
    eventAt: applied.event.at
  };
}
