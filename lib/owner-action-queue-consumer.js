import { normalizeOwnerActionCommand } from './owner-action-command.js';

function publicResponse(response = {}) {
  return JSON.stringify({
    ok: Boolean(response.ok),
    idempotent: Boolean(response.idempotent),
    executionStatus: response.executionStatus || null,
    verificationStatus: response.verificationStatus || null,
    error: response.error || null
  });
}

export async function consumeOwnerActionQueue({
  commands = [],
  markCommand,
  executeCommand,
  onCommandResult = async () => {},
  now = () => new Date()
}) {
  let succeeded = 0;
  let failed = 0;

  for (const row of commands) {
    const processedAt = now().toISOString();
    try {
      const command = normalizeOwnerActionCommand(row);
      await markCommand(row._row, { commandStatus: 'SENT', response: '', processedAt: '' });
      const response = await executeCommand(command);
      if (!response?.ok) throw new Error(response?.error || 'decision lifecycle rejected command');
      await markCommand(row._row, {
        commandStatus: 'SUCCESS',
        response: publicResponse(response),
        processedAt
      });
      await onCommandResult({
        requestId: command.requestId,
        commandStatus: 'SUCCESS',
        response: publicResponse(response),
        processedAt
      });
      succeeded += 1;
    } catch (error) {
      const response = String(error?.message || error);
      await markCommand(row._row, {
        commandStatus: 'ERROR',
        response,
        processedAt
      });
      await onCommandResult({
        requestId: String(row.requestId || ''),
        commandStatus: 'ERROR',
        response,
        processedAt
      });
      failed += 1;
    }
  }

  return { ready: commands.length, succeeded, failed };
}
