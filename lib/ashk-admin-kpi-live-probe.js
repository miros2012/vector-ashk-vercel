function text(value) {
  return String(value ?? '').trim();
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.Items)) return payload.Items;
  return [];
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function plainText(value) {
  return decodeHtml(String(value ?? '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function findTemplateId(payload, templateName) {
  const target = text(templateName);
  if (!target) return '';
  const row = rowsFromPayload(payload).find(item => text(item?.Name) === target);
  return row?.Id ?? '';
}

export function extractAlinaReportSnippet(html) {
  const source = plainText(html);
  const match = /Кумаритова\s+Алина|Алина\s+Кумаритова/iu.exec(source);
  if (!match) return '';
  const start = Math.max(0, match.index - 30);
  const end = Math.min(source.length, match.index + match[0].length + 520);
  return source.slice(start, end).trim().slice(0, 600);
}

export const ADMIN_KPI_MODES = Object.freeze([
  'BySaleDate',
  'ByRegDate',
  'ByContractDate',
  'ByFirstPayDate',
  'ByAnyDate'
]);

export async function probeAshkAdminKpiReports({ session, startDate, endDate } = {}) {
  if (!session || typeof session.requestJson !== 'function' || typeof session.requestText !== 'function') {
    throw new Error('ASHK authenticated session is required');
  }
  if (!text(startDate) || !text(endDate)) throw new Error('ASHK admin KPI period is required');

  const templates = await session.requestJson('/api/templatelist', { 'sort.property': 'Name' });
  const templateId = findTemplateId(templates, '_SYSADMINKPI');
  if (templateId === '') throw new Error('ASHK _SYSADMINKPI template not found');

  const reports = [];
  for (const mode of ADMIN_KPI_MODES) {
    const Data = JSON.stringify({
      Mode: mode,
      Period: 'Custom',
      StartDate: startDate,
      EndDate: endDate
    });
    const html = await session.requestText('/apia/DocInstanceGen', { TemplateId: templateId, Data });
    reports.push({
      mode,
      alinaSnippet: extractAlinaReportSnippet(html),
      hasAlina: Boolean(extractAlinaReportSnippet(html)),
      contentLength: String(html ?? '').length
    });
  }

  return { templateId, reports };
}
