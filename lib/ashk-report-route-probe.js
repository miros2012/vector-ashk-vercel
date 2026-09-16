function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function plainText(value) {
  return decodeHtml(String(value ?? '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function safePath(value) {
  const raw = decodeHtml(value).trim();
  if (!raw || /^javascript:/i.test(raw) || raw.startsWith('#')) return '';
  try {
    const url = new URL(raw, 'https://app.dscontrol.ru');
    if (url.origin !== 'https://app.dscontrol.ru') return '';
    return url.pathname;
  } catch {
    return '';
  }
}

function unique(values) {
  return [...new Set(values)];
}

export function extractAshkReportRouteCandidates(html) {
  const candidates = [];
  const seen = new Set();
  const linkPattern = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const relevance = /report|finance|payment|employee|activity|отч[её]т|финанс|оплат|сотруд|активност/i;
  let match;
  while ((match = linkPattern.exec(String(html ?? '')))) {
    const href = safePath(match[1]);
    const text = plainText(match[2]);
    if (!href || !relevance.test(`${href} ${text}`)) continue;
    const key = `${href}\u0000${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ href, text });
  }
  return candidates;
}

export function extractAshkAssetPaths(html) {
  const paths = [];
  const scriptPattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = scriptPattern.exec(String(html ?? '')))) {
    const path = safePath(match[1]);
    if (path && /\.js$/i.test(path)) paths.push(path);
  }
  return unique(paths);
}

export function extractAshkRouteStrings(source) {
  const routes = [];
  const relevance = /report|finance|payment|employee|activity/i;
  const quoted = /["']([^"'\r\n]+)["']/g;
  let match;
  while ((match = quoted.exec(String(source ?? '')))) {
    const raw = match[1];
    if (!raw.startsWith('/') && !/^https?:\/\//i.test(raw)) continue;
    const path = safePath(raw);
    if (!path || !relevance.test(path)) continue;
    routes.push(path);
  }
  return unique(routes);
}

export async function probeAshkReportRoutes({ session, maxAssets = 8 } = {}) {
  if (!session || typeof session.requestText !== 'function') {
    throw new Error('ASHK text session is required');
  }
  const html = await session.requestText('/');
  const result = [];
  const seenHrefs = new Set();
  const addCandidate = candidate => {
    const href = safePath(candidate?.href);
    if (!href || seenHrefs.has(href)) return;
    seenHrefs.add(href);
    result.push({ href, text: plainText(candidate?.text) });
  };

  for (const candidate of extractAshkReportRouteCandidates(html)) addCandidate(candidate);
  for (const href of extractAshkRouteStrings(html)) addCandidate({ href, text: '' });

  const assets = extractAshkAssetPaths(html).slice(0, Math.max(0, Number(maxAssets) || 0));
  for (const path of assets) {
    let source;
    try {
      source = await session.requestText(path);
    } catch {
      continue;
    }
    for (const href of extractAshkRouteStrings(source)) addCandidate({ href, text: '' });
  }
  return result;
}
