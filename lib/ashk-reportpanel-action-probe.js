import { extractAshkAssetPaths } from './ashk-report-route-probe.js';

function redact(value) {
  return String(value ?? '')
    .replace(/([?&][A-Za-z0-9_.-]+=)[^&"'\s)]+/g, '$1REDACTED')
    .replace(/(token|key|login|user|tenant|school|account)=([^&"'\s)]+)/gi, '$1=REDACTED')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function extractReportPanelActions(source, { radius = 1200, maxContexts = 12 } = {}) {
  const text = String(source ?? '');
  const contexts = [];
  const actionNames = [];
  const apiPaths = [];
  const tokenPattern = /reportpanel/gi;
  let match;
  while ((match = tokenPattern.exec(text)) && contexts.length < maxContexts) {
    const start = Math.max(0, match.index - radius);
    const end = Math.min(text.length, match.index + match[0].length + radius);
    const context = text.slice(start, end);
    const actionPattern = /Dsc\.server\.action\(\s*["']([^"']+)["']/gi;
    let actionMatch;
    while ((actionMatch = actionPattern.exec(context))) actionNames.push(actionMatch[1]);
    const apiPattern = /["'](\/api\/[A-Za-z0-9_.\/-]+)(?:\?[^"']*)?["']/gi;
    let apiMatch;
    while ((apiMatch = apiPattern.exec(context))) apiPaths.push(apiMatch[1]);
    contexts.push(redact(context).slice(0, 2600));
  }
  return {
    actions: uniqueSorted(actionNames),
    apiPaths: uniqueSorted(apiPaths),
    contexts
  };
}

export async function probeAshkReportPanelActions({ session, maxAssets = 36 } = {}) {
  if (!session || typeof session.requestText !== 'function') {
    throw new Error('ASHK text session is required');
  }
  const html = await session.requestText('/');
  const assets = extractAshkAssetPaths(html).slice(0, Math.max(0, Number(maxAssets) || 0));
  const actions = [];
  const apiPaths = [];
  const contexts = [];
  const add = result => {
    actions.push(...result.actions);
    apiPaths.push(...result.apiPaths);
    for (const context of result.contexts) {
      if (contexts.length < 20) contexts.push(context);
    }
  };
  add(extractReportPanelActions(html));
  for (const asset of assets) {
    let source;
    try {
      source = await session.requestText(asset);
    } catch {
      continue;
    }
    add(extractReportPanelActions(source));
  }
  return {
    assetCount: assets.length,
    actions: uniqueSorted(actions),
    apiPaths: uniqueSorted(apiPaths),
    contexts
  };
}
