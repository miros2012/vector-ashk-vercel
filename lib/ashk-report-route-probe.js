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
