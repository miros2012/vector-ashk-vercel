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

function namedModule(source, moduleName) {
  const text = String(source ?? '');
  const escaped = String(moduleName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`define\\(\\s*["']${escaped}["']`, 'i').exec(text);
  return match ? containingModule(text, match.index) : '';
}

function fieldObjects(moduleText) {
  const fields = new Map();
  const objectPattern = /\{[^{}]{0,800}\}/g;
  let objectMatch;
  while ((objectMatch = objectPattern.exec(moduleText))) {
    const fragment = objectMatch[0];
    const name = fragment.match(/\bname\s*:\s*["']([^"']+)["']/i)?.[1] || '';
    if (!name) continue;
    const label = fragment.match(/\blabel\s*:\s*["']([^"']*)["']/i)?.[1] || '';
    fields.set(name, { name, label });
  }
  return [...fields.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function extractPaymentRecordFilterHints(source) {
  const moduleText = namedModule(source, 'views/paymentrecord/filter');
  if (!moduleText) return { found: false, fields: [], context: '' };
  return {
    found: true,
    fields: fieldObjects(moduleText),
    context: compact(redact(moduleText)).slice(0, 6000)
  };
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
  const assets = extractAshkAssetPaths(html).slice(0, Math.max(0, Number(maxAssets) || 0));
  const sources = [{ asset: '/', source: html }];
  for (const asset of assets) {
    try {
      sources.push({ asset, source: await session.requestText(asset) });
    } catch {
      // Ignore one unavailable static asset and continue the bounded scan.
    }
  }

  let command = { asset: '', found: false, candidateKeys: [], context: '' };
  let filterFields = [];
  let filterContext = '';
  for (const item of sources) {
    if (!command.found) {
      const result = extractPaymentRecordDebitListHints(item.source);
      if (result.found) command = { asset: item.asset, ...result };
    }
    if (!filterFields.length) {
      const filter = extractPaymentRecordFilterHints(item.source);
      if (filter.found) {
        filterFields = filter.fields;
        filterContext = filter.context;
      }
    }
  }

  return {
    ...command,
    filterFields,
    filterContext
  };
}
