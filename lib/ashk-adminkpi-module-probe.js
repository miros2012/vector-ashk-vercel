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
  const raw = String(source ?? '');
  const hasNamedModule = /define\(\s*["']views\/reports\/adminkpi["']/i.test(raw);
  const moduleText = hasNamedModule ? extractDefinedModule(raw, 'views/reports/adminkpi') : raw;
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

export function extractTemplateStoreConfig(source) {
  const raw = String(source ?? '');
  const hasNamedModule = /define\(\s*["']models\/templates["']/i.test(raw);
  if (!hasNamedModule) {
    return { commands: [], apiPaths: [], context: '' };
  }
  const moduleText = extractDefinedModule(raw, 'models/templates');
  if (!moduleText) return { commands: [], apiPaths: [], context: '' };
  const commands = [];
  const commandPattern = /Dsc\.server\.(?:query|action)\(\s*["']([^"']+)["']/gi;
  let commandMatch;
  while ((commandMatch = commandPattern.exec(moduleText))) commands.push(commandMatch[1]);
  const apiPaths = [];
  const apiPattern = /["'](\/?api[a]?\/[A-Za-z0-9_.\/-]+)(?:\?[^"']*)?["']/gi;
  let apiMatch;
  while ((apiMatch = apiPattern.exec(moduleText))) apiPaths.push(apiMatch[1]);
  return {
    commands: uniqueSorted(commands),
    apiPaths: uniqueSorted(apiPaths),
    context: redact(moduleText).slice(0, 7000)
  };
}

export async function probeAshkAdminKpiModule({ session, maxAssets = 36 } = {}) {
  if (!session || typeof session.requestText !== 'function') {
    throw new Error('ASHK text session is required');
  }
  const html = await session.requestText('/');
  const assets = extractAshkAssetPaths(html).slice(0, Math.max(0, Number(maxAssets) || 0));
  let adminAsset = '';
  let adminKpi = extractAdminKpiReportConfig(html);
  if (adminKpi.templateName) adminAsset = '/';
  let templateStore = extractTemplateStoreConfig(html);
  for (const asset of assets) {
    let source;
    try {
      source = await session.requestText(asset);
    } catch {
      continue;
    }
    if (!adminKpi.templateName) {
      const candidate = extractAdminKpiReportConfig(source);
      if (candidate.templateName) {
        adminKpi = candidate;
        adminAsset = asset;
      }
    }
    if (!templateStore.context) {
      const candidate = extractTemplateStoreConfig(source);
      if (candidate.context) templateStore = candidate;
    }
    if (adminKpi.templateName && templateStore.context) break;
  }
  return {
    asset: adminAsset,
    ...adminKpi,
    templateStore
  };
}
