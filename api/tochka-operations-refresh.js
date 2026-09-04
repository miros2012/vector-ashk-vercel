import { getVercelOidcToken } from '@vercel/oidc';

const DEFAULT_BRIDGE_URL = 'https://tochka-realtime-bridge.onrender.com';

function requestBearer(req) {
  const authorization = String(req?.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function refreshOperationsSource() {
  const token = await getVercelOidcToken();
  if (!token) throw new Error('VERCEL_OIDC_TOKEN unavailable');

  const base = String(process.env.TOCHKA_BRIDGE_URL || DEFAULT_BRIDGE_URL).replace(/\/$/, '');
  const response = await fetch(`${base}/operations/refresh`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Tochka operations refresh HTTP ${response.status}: ${text.slice(0, 500)}`);
    error.status = response.status;
    throw error;
  }

  return { status: response.status, text };
}

export default async function handler(req, res) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (String(req?.method || '').toUpperCase() !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Use GET' });
  }

  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret || requestBearer(req) !== secret) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    const result = await refreshOperationsSource();
    console.log(JSON.stringify({ event: 'tochka-operations-source-refresh', status: result.status }));
    return res.status(200).json({ ok: true, source: 'tochka_operations', refreshed: true });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'tochka-operations-source-refresh-failed',
      status: Number(error?.status) || null,
      error: String(error?.message || error).slice(0, 500)
    }));
    return res.status(502).json({ ok: false, error: 'Tochka operations source refresh failed' });
  }
}
