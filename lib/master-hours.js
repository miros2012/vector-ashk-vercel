const REPORT_PATH = '/api/MasterWorkReportDetails';

function finiteNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function buildMasterReportUrl({ baseUrl, buildMode, startDate, endDate }) {
  const url = new URL(REPORT_PATH, baseUrl);
  url.search = new URLSearchParams({
    BuildMode: String(buildMode),
    PlanFact: '0',
    Period: '7',
    StartDate: startDate,
    EndDate: endDate
  }).toString();
  return url.toString();
}

export function extractReportRows(payload) {
  if (payload?.success === false) {
    throw new Error(payload?.data?.Message || 'ASHK rejected the report request');
  }
  if (!Array.isArray(payload?.data)) {
    throw new Error('ASHK report response does not contain a data array');
  }
  return payload.data;
}

export function summarizeMasterHours(rows) {
  const summary = {
    rows: rows.length,
    hours: 0,
    planHours: 0,
    parallelHours: 0,
    planParallelHours: 0,
    firstFactStart: null,
    lastFactStart: null,
    bySessionType: {}
  };

  for (const row of rows) {
    const hours = finiteNumber(row?.Hours);
    const planHours = finiteNumber(row?.PlanHours);
    const parallelHours = finiteNumber(row?.ParallelHours);
    const planParallelHours = finiteNumber(row?.PlanParallelHours);
    const factStart = typeof row?.FactStart === 'string' ? row.FactStart : null;
    const sessionType = String(row?.SessionTypeName || '(без типа)').trim();

    summary.hours += hours;
    summary.planHours += planHours;
    summary.parallelHours += parallelHours;
    summary.planParallelHours += planParallelHours;
    if (factStart && (!summary.firstFactStart || factStart < summary.firstFactStart)) {
      summary.firstFactStart = factStart;
    }
    if (factStart && (!summary.lastFactStart || factStart > summary.lastFactStart)) {
      summary.lastFactStart = factStart;
    }

    const bucket = summary.bySessionType[sessionType] || {
      rows: 0,
      hours: 0,
      planHours: 0,
      parallelHours: 0
    };
    bucket.rows += 1;
    bucket.hours += hours;
    bucket.planHours += planHours;
    bucket.parallelHours += parallelHours;
    summary.bySessionType[sessionType] = bucket;
  }

  summary.bySessionType = Object.fromEntries(
    Object.entries(summary.bySessionType).sort(([left], [right]) => left.localeCompare(right, 'ru'))
  );
  return summary;
}

