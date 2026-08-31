import {
  buildMasterReportUrl,
  extractReportRows,
  filterRowsByFactPeriod,
  summarizeMasterHours
} from '../lib/master-hours.js';

const ASHK_BASE_URL = 'https://app.dscontrol.ru';
const START_DATE = '2026-08-01T00:00:00';
const END_DATE = '2026-08-29T23:59:59';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getReport(buildMode) {
  const url = buildMasterReportUrl({
    baseUrl: ASHK_BASE_URL,
    buildMode,
    startDate: START_DATE,
    endDate: END_DATE
  });
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      api_key: process.env.ASHK_API_KEY,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(55_000)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ASHK MasterWorkReportDetails returned HTTP ${response.status}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('ASHK MasterWorkReportDetails returned invalid JSON');
  }
  const rawRows = extractReportRows(payload);
  const rows = filterRowsByFactPeriod(rawRows, START_DATE, END_DATE);
  return {
    totalCount: Number.isFinite(Number(payload.total_count)) ? Number(payload.total_count) : null,
    position: Number.isFinite(Number(payload.pos)) ? Number(payload.pos) : null,
    totals: payload.totals ?? null,
    rawRows: rawRows.length,
    excludedOutsideFactPeriod: rawRows.length - rows.length,
    ...summarizeMasterHours(rows)
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!process.env.ASHK_API_KEY) {
    return res.status(500).json({ ok: false, error: 'ASHK integration is not configured' });
  }

  try {
    const byOccupationType = await getReport(0);
    await delay(400);
    const byTrainingHourType = await getReport(1);
    return res.status(200).json({
      ok: true,
      mode: 'read_only_master_hours_report',
      source: 'GET /api/MasterWorkReportDetails',
      period: { startDate: START_DATE, endDate: END_DATE, localTime: true, postFilter: 'FactStart local calendar date' },
      reports: { byOccupationType, byTrainingHourType }
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      source: 'GET /api/MasterWorkReportDetails',
      error: String(error?.message || error)
    });
  }
}
