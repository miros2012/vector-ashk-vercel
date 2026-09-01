import { buildOwnerActionView } from './owner-action-view.js';

function finiteOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sheetsDateToIso(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = Date.UTC(1899, 11, 30) + Math.trunc(value) * 86400000;
    return new Date(timestamp).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const ru = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function parseDecision(row) {
  const ruleId = String(row?.[0] || '').trim();
  if (!ruleId) return null;
  return {
    ruleId,
    title: String(row?.[1] || '').trim() || null,
    deviation: String(row?.[2] || '').trim() || null,
    recommendation: String(row?.[4] || '').trim() || null,
    task: String(row?.[5] || '').trim() || null,
    assignee: String(row?.[6] || '').trim() || null,
    deadline: sheetsDateToIso(row?.[7]),
    priority: String(row?.[8] || '').trim() || null,
    active: String(row?.[9] || '').trim() === 'Активно',
    executionStatus: String(row?.[10] || '').trim() || null,
    plannedEffect: finiteOrNull(row?.[12]),
    actualEffect: finiteOrNull(row?.[13]),
    linkedObject: String(row?.[15] || '').trim() || null,
    rank: finiteOrNull(row?.[16]),
    lastResult: String(row?.[19] || '').trim() || null,
    verificationStatus: String(row?.[20] || '').trim() || 'Не проверено',
    lastChecked: String(row?.[21] || '').trim() || null
  };
}

export function createOwnerActionSheetAdapter({ sheets, spreadsheetId }) {
  if (!sheets?.spreadsheets?.values?.batchGet) throw new Error('sheets batchGet is required');
  if (!String(spreadsheetId || '').trim()) throw new Error('spreadsheetId is required');

  return {
    async readOwnerAction() {
      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: ["'Решения'!A2:V200"],
        valueRenderOption: 'UNFORMATTED_VALUE'
      });
      const rows = response.data.valueRanges?.[0]?.values || [];
      return buildOwnerActionView(rows.map(parseDecision).filter(Boolean));
    }
  };
}
