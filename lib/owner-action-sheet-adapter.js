import { buildOwnerActionView } from './owner-action-view.js';

const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);

function isoDate(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(SHEETS_EPOCH_MS + value * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  return text || null;
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapDecision(row = []) {
  return {
    ruleId: String(row[0] || '').trim(),
    title: String(row[1] || '').trim(),
    deviation: String(row[2] || '').trim(),
    why: String(row[3] || '').trim(),
    recommendation: String(row[4] || '').trim(),
    task: String(row[5] || '').trim(),
    assignee: String(row[6] || '').trim(),
    deadline: isoDate(row[7]),
    priority: String(row[8] || '').trim(),
    ruleStatus: String(row[9] || '').trim(),
    executionStatus: String(row[10] || 'Не начато').trim(),
    plannedEffect: numberOrNull(row[12]) ?? 0,
    actualEffect: numberOrNull(row[13]),
    linkedObject: String(row[15] || '').trim(),
    rank: numberOrNull(row[16]),
    startedAt: row[17] || null,
    completedAt: row[18] || null,
    lastResult: String(row[19] || '').trim(),
    verificationStatus: String(row[20] || 'Не проверено').trim(),
    lastChecked: row[21] || null
  };
}

export function createOwnerActionSheetAdapter({ sheets, spreadsheetId, decisionsSheet = 'Решения' }) {
  return {
    async readOwnerAction() {
      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: [`'${decisionsSheet}'!A2:V200`],
        valueRenderOption: 'UNFORMATTED_VALUE'
      });
      const rows = response.data.valueRanges?.[0]?.values || [];
      return buildOwnerActionView(rows.map(mapDecision).filter((row) => row.ruleId));
    }
  };
}
