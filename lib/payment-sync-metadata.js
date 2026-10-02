import { writeControlMarker } from './google-sheets-sync-marker.js';

export async function recordVerifiedPaymentSnapshot({ sheets, spreadsheetId, metrics, successUtc }) {
  const rows = Number(metrics?.rows);
  const debitTotal = Number(metrics?.debitTotal);
  if (!Number.isSafeInteger(rows) || rows < 0 || !Number.isFinite(debitTotal)) {
    throw new Error('Verified payment metrics are invalid');
  }
  for (const [key, value] of [
    ['payments_last_rows', String(rows)],
    ['payments_last_debit_total', String(debitTotal)],
    ['payments_last_success_utc', successUtc]
  ]) {
    await writeControlMarker({ sheets, spreadsheetId, key, value });
  }
}
