import { createDecisionExecutionHandler } from './decision-execution-handler.js';
import { createDecisionSheetAdapter } from './decision-sheet-adapter.js';

export function createDecisionEventApi({
  sheets,
  spreadsheetId,
  configuredKey,
  now = () => new Date(),
  eventId
}) {
  const adapter = createDecisionSheetAdapter({
    sheets,
    spreadsheetId,
    eventId
  });

  return createDecisionExecutionHandler({
    configuredKey,
    now,
    getDecision: adapter.getDecision,
    hasEvent: adapter.hasEvent,
    writeDecision: adapter.writeDecision,
    appendEvent: adapter.appendEvent
  });
}
