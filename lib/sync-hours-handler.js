import {
  buildHoursImportWorkbook,
  compareHoursMetrics,
  isAuthorizedSyncKey,
  masterReportPeriodForMonth,
  metricsFromHoursSheetValues
} from './hours-sync.js';

function requestKey(req) {
  const direct = String(req.headers?.['x-vector-key'] || '').trim();
  if (direct) return direct;
  const authorization = String(req.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function tyumenDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yekaterinburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return {
    month: `${part('year')}-${part('month')}`,
    day: Number(part('day'))
  };
}

function previousMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function createSyncHoursHandler({
  configuredKey = '',
  cronKey = '',
  bootstrapHash = '',
  fetchReport,
  writeRaw,
  readRaw,
  writeReconciliation,
  writeArchiveRaw,
  readArchiveRaw,
  writeArchiveReconciliation,
  rawSheet = 'АШК_Часы_Табель__vercel',
  reconciliationSheet = 'АШК_Сверка_часов__vercel',
  now = () => new Date()
}) {
  async function syncMonth(month, { archived = false } = {}) {
    if (archived && (!writeArchiveRaw || !readArchiveRaw || !writeArchiveReconciliation)) {
      throw new Error('Closed-month archive staging is not configured');
    }

    const loadedAt = now().toISOString();
    const reportRows = await fetchReport(month);
    const workbook = buildHoursImportWorkbook(reportRows, { month, loadedAt });

    if (archived) {
      await writeArchiveRaw(month, workbook.rawValues);
    } else {
      await writeRaw(workbook.rawValues);
    }

    const stagingValues = archived ? await readArchiveRaw(month) : await readRaw();
    const staging = metricsFromHoursSheetValues(stagingValues);
    const comparison = compareHoursMetrics(workbook.metrics, staging);
    const reconciliationValues = [
      ...workbook.reconciliationValues,
      [
        'verification',
        comparison.ok ? 'OK' : 'ERROR',
        staging.rows,
        staging.hours,
        month,
        loadedAt
      ]
    ];

    if (archived) {
      await writeArchiveReconciliation(month, reconciliationValues);
    } else {
      await writeReconciliation(reconciliationValues);
    }

    return {
      ok: comparison.ok,
      mode: 'staging_only',
      month,
      archived,
      sourceName: 'GET /api/MasterWorkReportDetails?BuildMode=1&PlanFact=0',
      rawSheet,
      reconciliationSheet,
      source: {
        rows: workbook.metrics.rows,
        hours: workbook.metrics.hours,
        duplicateRows: workbook.duplicateRows
      },
      staging,
      comparison,
      note: 'Рабочие листы, Фонд вождения и расчёт мастеров не изменены.'
    };
  }

  return async function syncHoursHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    const method = String(req.method || '').toUpperCase();
    if (method !== 'POST' && method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use POST or cron GET' });
    }

    const providedKey = requestKey(req);
    const authorized = method === 'GET'
      ? isAuthorizedSyncKey(providedKey, { configuredKey: cronKey })
      : isAuthorizedSyncKey(providedKey, { configuredKey, bootstrapHash });
    if (!authorized) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const requestedValue = String(req.body?.month || req.query?.month || '').trim();
    const tyumen = tyumenDateParts(now());
    const requestedMonth = method === 'GET' && requestedValue === 'previous'
      ? previousMonth(tyumen.month)
      : (requestedValue || tyumen.month);
    try {
      masterReportPeriodForMonth(requestedMonth);
    } catch (error) {
      return res.status(400).json({ ok: false, error: String(error?.message || error) });
    }

    try {
      let monthClose = null;
      const automaticMonthClose = method === 'GET' && !requestedValue && tyumen.day >= 1 && tyumen.day <= 3;
      if (automaticMonthClose) {
        const closeResult = await syncMonth(previousMonth(tyumen.month), { archived: true });
        monthClose = {
          month: closeResult.month,
          ok: closeResult.ok,
          archived: closeResult.archived,
          source: closeResult.source,
          staging: closeResult.staging,
          comparison: closeResult.comparison
        };
      }

      const response = await syncMonth(requestedMonth);
      const responseWithClose = monthClose ? { ...response, monthClose } : response;

      if (monthClose && !monthClose.ok) {
        return res.status(502).json({
          ...responseWithClose,
          ok: false,
          error: 'Previous month close verification failed'
        });
      }
      if (!response.comparison.ok) {
        return res.status(502).json({
          ...responseWithClose,
          ok: false,
          error: 'Staging verification failed'
        });
      }
      return res.status(200).json(responseWithClose);
    } catch (error) {
      console.error('sync-hours:', error);
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  };
}
