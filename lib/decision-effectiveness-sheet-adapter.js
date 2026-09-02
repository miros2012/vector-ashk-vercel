import { calculateDecisionEffectiveness } from './decision-effectiveness.js';

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function decisionFromRow(row = []) {
  return {
    ruleId: String(row[0] || '').trim(),
    executionStatus: String(row[10] || 'Не начато').trim(),
    plannedEffect: numberOrNull(row[12]) ?? 0,
    actualEffect: numberOrNull(row[13]),
    synthetic: String(row[14] || '').trim() === '__synthetic__',
    verificationStatus: String(row[20] || 'Не проверено').trim()
  };
}

function historyFromRow(row = []) {
  return {
    eventId: String(row[0] || '').trim(),
    ruleId: String(row[1] || '').trim(),
    type: String(row[2] || '').trim(),
    at: String(row[3] || '').trim(),
    before: String(row[4] || '').trim(),
    after: String(row[5] || '').trim(),
    actor: String(row[6] || '').trim(),
    plannedEffect: numberOrNull(row[7]),
    actualEffect: numberOrNull(row[8]),
    evidence: String(row[9] || '').trim(),
    comment: String(row[10] || '').trim()
  };
}

export function createDecisionEffectivenessSheetAdapter({
  sheets,
  spreadsheetId,
  decisionsSheet = 'Решения',
  historySheet = 'История решений'
}) {
  return {
    async readEffectiveness() {
      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: [
          `'${decisionsSheet}'!A2:V200`,
          `'${historySheet}'!A2:K1000`
        ],
        valueRenderOption: 'UNFORMATTED_VALUE'
      });
      const ranges = response.data.valueRanges || [];
      const decisions = (ranges[0]?.values || [])
        .map(decisionFromRow)
        .filter((decision) => decision.ruleId);
      const history = (ranges[1]?.values || [])
        .map(historyFromRow)
        .filter((event) => event.eventId && event.ruleId);
      return calculateDecisionEffectiveness({ decisions, history });
    }
  };
}
