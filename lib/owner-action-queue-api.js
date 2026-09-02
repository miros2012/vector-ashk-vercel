import { consumeOwnerActionQueue } from './owner-action-queue-consumer.js';
import {
  finalizeOwnerActionControl,
  stageOwnerActionControl
} from './owner-action-control-transport.js';
import { randomUUID } from 'node:crypto';

function requestKey(req) {
  const direct = String(req.headers?.['x-vector-key'] || '').trim();
  if (direct) return direct;
  const authorization = String(req.headers?.authorization || '');
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
}

export function createOwnerActionQueueApi({
  configuredKey = '',
  readReadyCommands,
  markCommand,
  executeCommand,
  readControl,
  appendCommand,
  setControlState,
  clearDashboardInputs,
  requestId = () => randomUUID(),
  now = () => new Date()
}) {
  return async function ownerActionQueueApi(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST' });
    if (!configuredKey || requestKey(req) !== configuredKey) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    try {
      let staged = { staged: 0, requestId: null };
      if (readControl) {
        const control = await readControl();
        staged = await stageOwnerActionControl({
          control, appendCommand, setControlState, requestId, now
        });
      }
      const commands = await readReadyCommands();
      const result = await consumeOwnerActionQueue({
        commands,
        markCommand,
        executeCommand,
        now,
        onCommandResult: staged.requestId && setControlState && clearDashboardInputs
          ? async (commandResult) => {
              if (commandResult.requestId !== staged.requestId) return;
              await finalizeOwnerActionControl({
                result: commandResult, setControlState, clearDashboardInputs
              });
            }
          : undefined
      });
      return res.status(200).json({ ok: true, staged: staged.staged, ...result });
    } catch (error) {
      console.error('owner-action-queue:', error);
      return res.status(500).json({ ok: false, error: 'owner action queue unavailable' });
    }
  };
}
