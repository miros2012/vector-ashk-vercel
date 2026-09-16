import { extractAshkAssetPaths } from './ashk-report-route-probe.js';

function compact(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function redact(value) {
  return String(value ?? '')
    .replace(/([?&][A-Za-z0-9_.-]+=)[^&"'\s)]+/g, '$1REDACTED')
    .replace(/(token|key|login|user|tenant|school|account|company)=([^&"'\s)]+)/gi, '$1=REDACTED');
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function containingModule(source, index) {
  const text = String(source ?? '');
  const definePattern = /define\(\s*["'][^"']+["']/gi;
  let start = -1;
  let match;
  while ((match = definePattern.exec(text))) {
    if (match.index > index) break;
    start = match.index;
  }
  if (start < 0) {
    return text.slice(Math.max(0, index - 2500), Math.min(text.length, index + 2500));
  }
  definePattern.lastIndex = index + 1;
  const next = definePattern.exec(text);
  const end = next ? next.index : Math.min(text.length, index + 5000);
  return text.slice(start, end);
}

function returnedObjectKeys(moduleText) {
  const keys = [];
  const returnPattern = /return\s*\{([^{}]{0,2400})\}/gi;
  let returnMatch;
  while ((returnMatch = returnPattern.exec(moduleText))) {
    const keyPattern = /(?:^|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g;
    let keyMatch;
    while ((keyMatch = keyPattern.exec(returnMatch[1]))) keys.push(keyMatch[1]);
  }
  return uniqueSorted(keys);
}

export function extractPaymentRecordDebitListHints(source) {
  const text = String(source ?? '');
  const match = /PaymentRecordDebitList/i.exec(text);
  if (!match) return { found: false, candidateKeys: [], context: '' };
  const moduleText = containingModule(text, match.index);
  return {
    found: true,
    candidateKeys: returnedObjectKeys(moduleText),
    context: compact(redact(moduleText)).slice(0, 5000)
  };
}

export async function probeAshkPaymentRecordDebitListHints({ session, maxAssets = 36 } = {}) {
  if (!session || typeof session.requestText !== 'function') {
    throw new Error('ASHK text session is required');
  }
  const html = await session.requestText('/');
  const root = extractPaymentRecordDebitListHints(html);
  if (root.found) return { asset: '/', ...root };
  const assets = extractAshkAssetPaths(html).slice(0, Math.max(0, Number(maxAssets) || 0));
  for (const asset of assets) {
    let source;
    try {
      source = await session.requestText(asset);
    } catch {
      continue;
    }
    const result = extractPaymentRecordDebitListHints(source);
    if (result.found) return { asset, ...result };
  }
  return { asset: '', found: false, candidateKeys: [], context: '' };
}
