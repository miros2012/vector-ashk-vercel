import { extractDefinedModule } from './ashk-adminkpi-module-probe.js';
import { extractAshkAssetPaths } from './ashk-report-route-probe.js';

function text(value) {
  return String(value ?? '').trim();
}

function redact(value) {
  return String(value ?? '')
    .replace(/([?&][A-Za-z0-9_.-]+=)[^&"'\s)]+/g, '$1REDACTED')
    .replace(/(token|key|login|password|tenant|school|account|company)=([^&"'\s)]+)/gi, '$1=REDACTED');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function collectObjectKeys(fragment) {
  const keys = [];
  const keyPattern = /(?:^|[,;{])\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g;
  let match;
  while ((match = keyPattern.exec(String(fragment ?? '')))) keys.push(match[1]);
  return unique(keys);
}

export function extractPaymentRecordModuleHints(source) {
  const moduleText = extractDefinedModule(source, 'views/paymentrecord/list');
  if (!moduleText) {
    return { found: false, command: '', queryKeys: [], usesGetValues: false, context: '' };
  }
  const command = moduleText.match(/\bcommand\s*:\s*["']([^"']+)["']/i)?.[1] || '';
  const queryKeys = [];
  const queryPattern = /queryParams\s*:\s*function\s*\([^)]*\)\s*\{([\s\S]{0,5000}?)\}(?=\s*[,}])/gi;
  let queryMatch;
  while ((queryMatch = queryPattern.exec(moduleText))) {
    queryKeys.push(...collectObjectKeys(queryMatch[1]));
  }
  if (!queryKeys.length) {
    const commandIndex = moduleText.search(/PaymentRecordDebitList/i);
    const fragment = commandIndex >= 0
      ? moduleText.slice(Math.max(0, commandIndex - 3500), Math.min(moduleText.length, commandIndex + 7000))
      : moduleText;
    queryKeys.push(...collectObjectKeys(fragment));
  }
  return {
    found: true,
    command,
    queryKeys: unique(queryKeys).sort((a, b) => a.localeCompare(b)),
    usesGetValues: /\.getValues\s*\(/i.test(moduleText),
    context: redact(moduleText).replace(/\s+/g, ' ').trim().slice(0, 12000)
  };
}

export async function probeAshkPaymentRecordModule({ session, maxAssets = 36 } = {}) {
  if (!session || typeof session.requestText !== 'function') {
    throw new Error('ASHK payment record module probe requires an authenticated text session');
  }
  const html = await session.requestText('/');
  const root = extractPaymentRecordModuleHints(html);
  if (root.found) return { asset: '/', ...root };
  const assets = extractAshkAssetPaths(html).slice(0, Math.max(0, Number(maxAssets) || 0));
  for (const asset of assets) {
    try {
      const result = extractPaymentRecordModuleHints(await session.requestText(asset));
      if (result.found) return { asset, ...result };
    } catch {
      // Continue bounded static-asset inspection.
    }
  }
  return { asset: '', found: false, command: '', queryKeys: [], usesGetValues: false, context: '' };
}
