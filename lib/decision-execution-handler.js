import { executeDecisionCommand } from './decision-command.js';

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

    try {
      const result = await executeDecisionCommand({
        command: req.body || {},
        getDecision,
        hasEvent,
        writeDecision,
        appendEvent,
        now
      });
      return res.status(200).json(result);
    } catch (error) {
      const statusCode = Number(error?.statusCode);
      const ruleId = String(error?.ruleId || req.body?.ruleId || '').trim() || undefined;
      if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500) {
        return res.status(statusCode).json({
          ok: false,
          error: String(error?.message || error),
          ...(ruleId ? { ruleId } : {}),
          ...(error?.expectedExecutionStatus ? { expectedExecutionStatus: error.expectedExecutionStatus } : {}),
          ...(error?.currentExecutionStatus ? { currentExecutionStatus: error.currentExecutionStatus } : {})
        });
      }
      console.error('decision-execution:', error);
      return res.status(500).json({
        ok: false,
        error: String(error?.message || error),
        ...(ruleId ? { ruleId } : {})
      });
    }
  };
}
