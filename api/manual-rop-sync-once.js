import { createHash, timingSafeEqual } from 'node:crypto';
import nightlyFinanceOrchestrator from './nightly-finance-orchestrator.js';

const EXPECTED_TOKEN_HASH = 'e5a7595324562257f36b13dee83549198633b8d753fc6fcde31cd39e13c8c663';

function tokenMatches(value) {
  const digest = createHash('sha256').update(String(value || '')).digest('hex');
  return timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(EXPECTED_TOKEN_HASH, 'hex'));
}

export default async function handler(req, res) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (String(req?.method || '').toUpperCase() !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Use GET' });
  }
  if (!tokenMatches(req?.headers?.['x-manual-token'])) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  if (!cronSecret) {
    return res.status(500).json({ ok: false, error: 'CRON_SECRET missing' });
  }
  const internalReq = {
    ...req,
    headers: {
      ...(req?.headers || {}),
      authorization: `Bearer ${cronSecret}`
    }
  };
  return nightlyFinanceOrchestrator(internalReq, res);
}
