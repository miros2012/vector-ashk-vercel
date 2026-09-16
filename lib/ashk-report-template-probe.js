import { extractAshkAssetPaths } from './ashk-report-route-probe.js';

function decode(value) {
  return String(value ?? '')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstFieldValue(source, field) {
  const match = source.match(new RegExp(`${field}\\s*:\\s*["']([^"']+)["']`, 'i'));
  return match ? decode(match[1]) : '';
}

function lastFieldValue(source, field) {
  const pattern = new RegExp(`${field}\\s*:\\s*["']([^"']+)["']`, 'gi');
  let value = '';
  let match;
  while ((match = pattern.exec(source))) value = decode(match[1]);
  return value;
}

export function extractReportPanels(source) {
  const text = String(source ?? '');
  const found = [];
  const seen = new Set();
  const pattern = /templateName\s*:\s*["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(text))) {
    const templateName = decode(match[1]);
    const start = Math.max(0, match.index - 220);
    const end = Math.min(text.length, match.index + match[0].length + 220);
    const context = text.slice(start, end);
    if (!/reportpanel/i.test(context)) continue;
    const after = text.slice(match.index + match[0].length, Math.min(text.length, match.index + match[0].length + 180));
    const before = text.slice(Math.max(0, match.index - 180), match.index);
    const title = firstFieldValue(after, 'title') || lastFieldValue(before, 'title');
    const key = `${templateName}\u0000${title}`;
    if (!templateName || seen.has(key)) continue;
    seen.add(key);
    found.push({ templateName, title });
  }
  return found;
}

export async function probeAshkReportTemplates({ session, maxAssets = 36 } = {}) {
  if (!session || typeof session.requestText !== 'function') {
    throw new Error('ASHK text session is required');
  }
  const html = await session.requestText('/');
  const assets = extractAshkAssetPaths(html).slice(0, Math.max(0, Number(maxAssets) || 0));
  const templates = [];
  const seen = new Set();
  const add = item => {
    const key = `${item.templateName}\u0000${item.title}`;
    if (seen.has(key)) return;
    seen.add(key);
    templates.push(item);
  };
  for (const item of extractReportPanels(html)) add(item);
  for (const asset of assets) {
    let source;
    try {
      source = await session.requestText(asset);
    } catch {
      continue;
    }
    for (const item of extractReportPanels(source)) add(item);
  }
  return { assetCount: assets.length, templates };
}
