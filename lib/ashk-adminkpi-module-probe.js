import { extractAshkAssetPaths } from './ashk-report-route-probe.js';

function redact(value) {
  return String(value ?? '')
    .replace(/([?&][A-Za-z0-9_.-]+=)[^&"'\s)]+/g, '$1REDACTED')
    .replace(/(token|key|login|user|tenant|school|account)=([^&"'\s)]+)/gi, '$1=REDACTED')
    .trim();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function extractDefinedModule(source, moduleName) {
  const text = String(source ?? '');
  const escaped = String(moduleName ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startMatch = new RegExp(`define\\(\\s*["']${escaped}["']`, 'i').exec(text);
  if (!startMatch) return '';
  const start = startMatch.index;
  const rest = text.slice(start + startMatch[0].length);
  const next = /(?:^|[),;])\s*define\(\s*["'][^"']+["']/i.exec(rest);
  const end = next ? start + startMatch[0].length + next.index : text.length;
  return text.slice(start, end);
}

export function extractAdminKpiReportConfig(source) {
  const moduleText = /define\(\s*["']views\/reports\/adminkpi["']/i.test(String(source ?? ''))
    ? extractDefinedModule(source, 'views/reports/adminkpi')
    : String(source ?? '');
  if (!moduleText) return { templateName: '', refs: [], dataKeys: [], context: '' };
  const templateMatch = moduleText.match(/templateName\s*:\s*["']([^"']+)["']/i);
  const refs = [];
  const refPattern = /findBy\([^)]*?["']([^"']+)["']\s*\)/gi;
  let refMatch;
  while ((refMatch = refPattern.exec(moduleText))) refs.push(refMatch[1]);
  const dataKeys = [];
  const loadPattern = /\.loadWith\(\s*\{([^{}]{0,1600})\}\s*\)/gi;
  let loadMatch;
  while ((loadMatch = loadPattern.exec(moduleText))) {
    const keyPattern = /(?:^|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g;
    let keyMatch;
    while ((keyMatch = keyPattern.exec(loadMatch[1]))) dataKeys.push(keyMatch[1]);
  }
  return {
    templateName: templateMatch?.[1] || '',
    refs: uniqueSorted(refs),
    dataKeys: uniqueSorted(dataKeys),
    context: redact(moduleText).slice(0, 9000)
  };
}

export async function probeAshkAdminKpiModule({ session, maxAssets = 36 } = {}) {
  if (!session || typeof session.requestText !== 'function') {
    throw new Error('ASHK text session is required');
  }
  const html = await session.requestText('/');
  const direct = extractAdminKpiReportConfig(html);
  if (direct.templateName) return { asset: '/', ...direct };
  const assets = extractAshkAssetPaths(html).slice(0, Math.max(0, Number(maxAssets) || 0));
  for (const asset of assets) {
    let source;
    try {
      source = await session.requestText(asset);
    } catch {
      continue;
    }
    const result = extractAdminKpiReportConfig(source);
    if (result.templateName) return { asset, ...result };
  }
  return { asset: '', templateName: '', refs: [], dataKeys: [], context: '' };
}
