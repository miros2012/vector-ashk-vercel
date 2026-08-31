import { applyDecisionAction } from './decision-execution.js';

function requestKey(req) {
  const direct = String(req.headers?.['x-vector-key'] || '').trim();
  if (direct) return direct;
  const authorization = String(req.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export function createDecisionExecutionHandler({
  configuredKey = '',
  getDecision,
  hasEvent = async () => false,
  writeDecision,
  appendEvent,
  now = () => new Date()
}) {
  return async function decisionExecutionHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Use POST' });
    }

    const key = requestKey(req);
    if (!configuredKey || key !== configuredKey) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const ruleId = String(req.body?.ruleId || '').trim();
    if (!ruleId) {
      return res.status(400).json({ ok: false, error: 'ruleId is required' });
    }
    const requestId = String(req.body?.requestId || '').trim();

    try {
      const current = await getDecision(ruleId);
      if (!current) {
        return res.status(404).json({ ok: false, error: 'decision not found', ruleId });
      }

      if (requestId && await hasEvent(requestId)) {
        return res.status(200).json({
          ok: true,
          idempotent: true,
          requestId,
          ruleId,
          executionStatus: current.executionStatus,
          verificationStatus: current.verificationStatus,
          actualEffect: current.actualEffect
        });
      }

      if (String(current.ruleStatus || '').trim() !== 'Активно') {
        return res.status(409).json({ ok: false, error: 'inactive financial rule cannot be executed', ruleId });
      }

      const applied = applyDecisionAction(current, req.body || {}, now());
      const event = requestId ? { ...applied.event, eventId: requestId } : applied.event;
      await writeDecision(ruleId, applied.next);
      await appendEvent(event);

      return res.status(200).json({
        ok: true,
        idempotent: false,
        requestId: requestId || null,
        ruleId,
        action: String(req.body?.action || ''),
        executionStatus: applied.next.executionStatus,
        verificationStatus: applied.next.verificationStatus,
        actualEffect: applied.next.actualEffect,
        eventType: applied.event.type,
        eventAt: applied.event.at
      });
    } catch (error) {
      const message = String(error?.message || error);
      const isValidation = /requires|unsupported|must be|is required/.test(message);
      if (isValidation) {
        return res.status(400).json({ ok: false, error: message, ruleId });
      }
      console.error('decision-execution:', error);
      return res.status(500).json({ ok: false, error: message, ruleId });
    }
  };
}
