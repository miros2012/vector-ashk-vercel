function text(value) {
  return String(value ?? '').trim();
}

function firstQueryValue(value) {
  if (Array.isArray(value)) return text(value[0]);
  return text(value);
}

function sanitizeUrl(value) {
  const raw = text(value);
  if (!raw) return raw;
  try {
    const parsed = new URL(raw, 'https://internal.invalid');
    parsed.searchParams.delete('finance_run_token');
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return raw.replace(/([?&])finance_run_token=[^&]*&?/g, (_, prefix) => prefix === '?' ? '?' : '')
      .replace(/[?&]$/, '');
  }
}

function authorizedRequest(req, cronSecret) {
  const query = { ...(req?.query || {}) };
  delete query.finance_run_token;
  const clone = Object.create(req || null);
  Object.defineProperties(clone, {
    headers: {
      value: { ...(req?.headers || {}), authorization: `Bearer ${cronSecret}` },
      enumerable: true,
      configurable: true
    },
    query: {
      value: query,
      enumerable: true,
      configurable: true
    },
    url: {
      value: sanitizeUrl(req?.url),
      enumerable: true,
      configurable: true
    }
  });
  if ('originalUrl' in (req || {})) {
    Object.defineProperty(clone, 'originalUrl', {
      value: sanitizeUrl(req?.originalUrl),
      enumerable: true,
      configurable: true
    });
  }
  return clone;
}

export function hasManualFinanceRunToken(req) {
  return Boolean(firstQueryValue(req?.query?.finance_run_token));
}

export function createManualFinanceRunHandler({
  cronSecret,
  consumeToken,
  runNightly
} = {}) {
  if (typeof consumeToken !== 'function') throw new Error('consumeToken is required');
  if (typeof runNightly !== 'function') throw new Error('runNightly is required');

  return async function manualFinanceRunHandler(req, res) {
    res.setHeader?.('Cache-Control', 'no-store');
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use GET' });
    }

    const secret = text(cronSecret);
    if (!secret) {
      return res.status(503).json({ ok: false, error: 'Manual finance run unavailable' });
    }

    const token = firstQueryValue(req?.query?.finance_run_token);
    if (!token) return res.status(403).json({ ok: false, error: 'forbidden' });

    let consumed;
    try {
      consumed = await consumeToken(token);
    } catch (error) {
      console.error('manual-finance-run-token:', error?.name || 'Error');
      return res.status(503).json({ ok: false, error: 'Manual finance run unavailable' });
    }
    if (!consumed?.ok) return res.status(403).json({ ok: false, error: 'forbidden' });

    return runNightly(authorizedRequest(req, secret), res);
  };
}