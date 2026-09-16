import { extractAshkAssetPaths } from './ashk-report-route-probe.js';
import { extractReportPanels } from './ashk-report-template-probe.js';
import { extractReportPanelActions } from './ashk-reportpanel-action-probe.js';
import {
  extractAdminKpiReportConfig,
  extractTemplateStoreConfig
} from './ashk-adminkpi-module-probe.js';

function compact(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function redact(value) {
  return String(value ?? '')
    .replace(/([?&][A-Za-z0-9_.-]+=)[^&"'\s)]+/g, '$1REDACTED')
    .replace(/(tenant|school|account|token|key|login|user|company)=([^&"'\s)]+)/gi, '$1=REDACTED');
}

function boundedContext(source, index, tokenLength, radius) {
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + tokenLength + radius);
  return compact(redact(source.slice(start, end))).slice(0, 220);
}

export function extractAshkReportKeywordHints(source, { contextRadius = 120, maxMatches = 40 } = {}) {
  const text = String(source ?? '');
  const radius = Math.max(40, Math.min(200, Number(contextRadius) || 120));
  const max = Math.max(1, Math.min(100, Number(maxMatches) || 40));
  const anchors = /employee|staff|personnel|сотруд\w*|администратор\w*/gi;
  const relevant = /payment|paid|debit|activity|report|finance|оплат\w*|активност\w*|отч[её]т\w*|финанс\w*/i;
  const strong = /employeeactivity|staffactivity|payments?byemployee|employeepayments?|paymentemployee|employee.*report|report.*employee|активност\w*\s+сотруд\w*|принят\w*\s+оплат\w*/i;
  const result = [];
  const seen = new Set();
  let match;
  while ((match = anchors.exec(text)) && result.length < max) {
    const context = boundedContext(text, match.index, match[0].length, radius);
    if (!relevant.test(context) && !strong.test(context)) continue;
    const key = context.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ keyword: match[0], context });
  }
  if (result.length < max) {
    const direct = /employeeactivity|staffactivity|payments?byemployee|employeepayments?|paymentemployee|активност\w*\s+сотруд\w*|принят\w*\s+оплат\w*/gi;
    while ((match = direct.exec(text)) && result.length < max) {
      const context = boundedContext(text, match.index, match[0].length, radius);
      const key = context.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ keyword: match[0], context });
    }
  }
  return result;
}

export async function probeAshkReportKeywordHints({ session, maxAssets = 36 } = {}) {
  if (!session || typeof session.requestText !== 'function') {
    throw new Error('ASHK text session is required');
  }
  const html = await session.requestText('/');
  const assets = extractAshkAssetPaths(html).slice(0, Math.max(0, Number(maxAssets) || 0));
  const matches = extractAshkReportKeywordHints(html).map(item => ({ asset: '/', ...item }));
  const templates = [];
  const templateKeys = new Set();
  const reportPanelActions = new Set();
  const reportPanelApiPaths = new Set();
  const reportPanelContexts = [];
  let adminKpi = extractAdminKpiReportConfig(html);
  let templateStore = extractTemplateStoreConfig(html);
  const addDiagnostics = source => {
    for (const item of extractReportPanels(source)) {
      const key = `${item.templateName}\u0000${item.title}`;
      if (templateKeys.has(key)) continue;
      templateKeys.add(key);
      templates.push(item);
    }
    if (!adminKpi.templateName) {
      const candidate = extractAdminKpiReportConfig(source);
      if (candidate.templateName) adminKpi = candidate;
    }
    if (!templateStore.context) {
      const candidate = extractTemplateStoreConfig(source);
      if (candidate.context) templateStore = candidate;
    }
    const reportPanel = extractReportPanelActions(source);
    for (const item of reportPanel.actions) reportPanelActions.add(item);
    for (const item of reportPanel.apiPaths) reportPanelApiPaths.add(item);
    for (const context of reportPanel.contexts) {
      if (reportPanelContexts.length < 12) reportPanelContexts.push(context);
    }
  };
  addDiagnostics(html);
  for (const asset of assets) {
    let source;
    try {
      source = await session.requestText(asset);
    } catch {
      continue;
    }
    addDiagnostics(source);
    for (const item of extractAshkReportKeywordHints(source)) {
      matches.push({ asset, ...item });
      if (matches.length >= 80) break;
    }
    if (matches.length >= 80) break;
  }
  return {
    assetCount: assets.length,
    templates,
    adminKpi: { ...adminKpi, templateStore },
    reportPanel: {
      actions: [...reportPanelActions].sort((a, b) => a.localeCompare(b)),
      apiPaths: [...reportPanelApiPaths].sort((a, b) => a.localeCompare(b)),
      contexts: reportPanelContexts
    },
    matches
  };
}
