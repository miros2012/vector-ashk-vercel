import { calculateDecisionEffectiveness } from './decision-effectiveness.js';

function finiteOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseDecision(row) {
  const ruleId = String(row?.[0] || '').trim();
  if (!ruleId) return null;
  return {
    ruleId,
    executionStatus: String(row?.[10] || 'Не начато').trim(),
    plannedEffect: finiteOrNull(row?.[12]) ?? 0,
    actualEffect: finiteOrNull(row?.[13]),
    verificationStatus: String(row?.[20] || 'Не проверено').trim()
  };
}

function parseHistory(row) {
  const eventId = String(row?.[0] || '').trim();
  if (!eventId) return null;
  return {
    eventId,
    ruleId: String(row?.[1] || '').trim(),
    type: String(row?.[2] || '').trim(),
    at: String(row?.[3] || '').trim(),
    before: String(row?.[4] || '').trim(),
    after: String(row?.[5] || '').trim(),
    actor: String(row?.[6] || '').trim(),
    plannedEffect: finiteOrNull(row?.[7]) ?? 0,
    actualEffect: finiteOrNull(row?.[8]),
    evidence: String(row?.[9] || '').trim(),
    comment: String(row?.[10] || '').trim(),
    verificationStatus: String(row?.[2] || '').trim() === 'Проверено'
      ? (finiteOrNull(row?.[8]) !== null ? 'Подтверждено' : null)
      : null
  };
}

export function createDecisionEffectivenessSheetAdapter({ sheets, spreadsheetId }) {
  if (!sheets?.spreadsheets?.values?.batchGet) throw new Error('sheets batchGet is required');
  if (!String(spreadsheetId || '').trim()) throw new Error('spreadsheetId is required');

  return {
    async readEffectiveness() {
      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: ["'Решения'!A2:V200", "'История решений'!A2:K1000"],
        valueRenderOption: 'UNFORMATTED_VALUE'
      });
      const ranges = response.data.valueRanges || [];
      const decisions = (ranges[0]?.values || []).map(parseDecision).filter(Boolean);
      const history = (ranges[1]?.values || []).map(parseHistory).filter(Boolean);
      return calculateDecisionEffectiveness({ decisions, history });
    }
  };
}
