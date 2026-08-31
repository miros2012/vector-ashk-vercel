import { randomUUID } from 'node:crypto';
import {
  decisionFromSheetRow,
  buildDecisionUpdates,
  buildHistoryRow
} from './decision-sheet-store.js';

export function createDecisionSheetAdapter({
  sheets,
  spreadsheetId,
  decisionsSheet = 'Решения',
  historySheet = 'История решений',
  eventId = () => `EVT-${randomUUID()}`
}) {
  let pending = null;
  let nextHistoryRow = 2;
  let historyEventIds = new Set();

  return {
    async getDecision(ruleId) {
      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: [
          `'${decisionsSheet}'!A2:V200`,
          `'${historySheet}'!A2:A1000`
        ],
        valueRenderOption: 'UNFORMATTED_VALUE'
      });
      const ranges = response.data.valueRanges || [];
      const decisionRows = ranges[0]?.values || [];
      const historyIds = ranges[1]?.values || [];
      const ids = historyIds
        .map((row) => String(row?.[0] || '').trim())
        .filter(Boolean);
      historyEventIds = new Set(ids);
      nextHistoryRow = historyIds.length + 2;

      const index = decisionRows.findIndex((row) => String(row?.[0] || '').trim() === String(ruleId || '').trim());
      if (index < 0) return null;
      return decisionFromSheetRow(decisionRows[index], index + 2);
    },

    async hasEvent(id) {
      const key = String(id || '').trim();
      return Boolean(key) && historyEventIds.has(key);
    },

    async writeDecision(ruleId, next) {
      pending = { ruleId: String(ruleId || '').trim(), next };
    },

    async appendEvent(event) {
      if (!pending?.next) throw new Error('decision update is not staged');
      if (String(event?.ruleId || '').trim() !== pending.ruleId) {
        throw new Error('event ruleId does not match staged decision');
      }

      const stableEventId = String(event?.eventId || '').trim() || eventId(event);
      const updates = buildDecisionUpdates(pending.next._row, pending.next);
      updates.push({
        range: `'${historySheet}'!A${nextHistoryRow}:K${nextHistoryRow}`,
        values: [buildHistoryRow(event, stableEventId)]
      });

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updates
        }
      });
      historyEventIds.add(stableEventId);
      pending = null;
      nextHistoryRow += 1;
    }
  };
}
