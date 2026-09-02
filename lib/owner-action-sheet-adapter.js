import { buildOwnerActionView } from './owner-action-view.js';

const GOOGLE_EPOCH_MS = Date.UTC(1899, 11, 30);

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(GOOGLE_EPOCH_MS + value * 86400000).toISOString().slice(0, 10);
  }
  return String(value);
}

export function ownerActionDecisionFromRow(row = []) {
  return {
    ruleId: String(row[0] || '').trim(),
    title: String(row[1] || '').trim(),
    deviation: String(row[2] || '').trim(),
    recommendation: String(row[4] || '').trim(),
    task: String(row[5] || '').trim(),
    assignee: String(row[6] || '').trim(),
    deadline: normalizeDate(row[7]),
    priority: String(row[8] || '').trim(),
    ruleStatus: String(row[9] || '').trim(),
    executionStatus: String(row[10] || 'Не начато').trim(),
    plannedEffect: numberOrNull(row[12]) ?? 0,
    actualEffect: numberOrNull(row[13]),
    synthetic: String(row[14] || '').trim() === '__synthetic__',
    linkedObject: String(row[15] || '').trim(),
    rank: numberOrNull(row[16]),
    lastResult: String(row[19] || '').trim(),
    verificationStatus: String(row[20] || 'Не проверено').trim(),
    lastChecked: normalizeDate(row[21])
  };
}

export function createOwnerActionSheetAdapter({
  sheets,
  spreadsheetId,
  decisionsSheet = 'Решения'
}) {
  return {
    async readOwnerAction() {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${decisionsSheet}'!A2:V200`,
        valueRenderOption: 'UNFORMATTED_VALUE'
      });
      const decisions = (response.data.values || [])
        .map(ownerActionDecisionFromRow)
        .filter((decision) => decision.ruleId);
      return buildOwnerActionView(decisions);
    }
  };
}
