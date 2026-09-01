function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validDate(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function hoursBetween(start, end) {
  const a = validDate(start);
  const b = validDate(end);
  if (a === null || b === null || b < a) return null;
  return (b - a) / 3600000;
}

function dedupeHistory(history) {
  const seen = new Set();
  return history.filter((event) => {
    const id = String(event?.eventId || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function ruleTimeline(events) {
  const sorted = [...events]
    .filter((event) => validDate(event.at) !== null)
    .sort((a, b) => validDate(a.at) - validDate(b.at));
  const firstAt = sorted[0]?.at || null;
  const startedAt = sorted.find((event) => event.type === 'Взято в работу')?.at || null;
  const completedAt = sorted.find((event) => event.type === 'Завершено')?.at || null;
  const verifiedAt = sorted.find((event) => event.type === 'Проверено')?.at || null;
  return { firstAt, startedAt, completedAt, verifiedAt };
}

export function calculateDecisionEffectiveness({ decisions = [], history = [] } = {}) {
  const rows = decisions.filter((row) => String(row?.ruleId || '').trim());
  const recommendationCount = rows.length;
  const startedCount = rows.filter((row) => ['В работе', 'Готово'].includes(String(row.executionStatus || ''))).length;
  const completedCount = rows.filter((row) => String(row.executionStatus || '') === 'Готово').length;
  const verifiedRows = rows.filter((row) => {
    const status = String(row.verificationStatus || 'Не проверено');
    return status && status !== 'Не проверено';
  });
  const verifiedCount = verifiedRows.length;
  const confirmedRows = verifiedRows.filter((row) => String(row.verificationStatus || '') === 'Подтверждено' && finite(row.actualEffect) !== null);
  const confirmedEffectCount = confirmedRows.length;
  const totalConfirmedEffect = confirmedRows.reduce((sum, row) => sum + finite(row.actualEffect), 0);

  const grouped = new Map();
  for (const event of dedupeHistory(history)) {
    const ruleId = String(event?.ruleId || '').trim();
    if (!ruleId) continue;
    if (!grouped.has(ruleId)) grouped.set(ruleId, []);
    grouped.get(ruleId).push(event);
  }

  const startDurations = [];
  const completeDurations = [];
  const verifyDurations = [];
  for (const events of grouped.values()) {
    const timeline = ruleTimeline(events);
    const toStart = hoursBetween(timeline.firstAt, timeline.startedAt);
    const toComplete = hoursBetween(timeline.startedAt, timeline.completedAt);
    const toVerify = hoursBetween(timeline.completedAt, timeline.verifiedAt);
    if (toStart !== null) startDurations.push(toStart);
    if (toComplete !== null) completeDurations.push(toComplete);
    if (toVerify !== null) verifyDurations.push(toVerify);
  }

  let comparablePlanned = 0;
  let comparableActual = 0;
  for (const row of confirmedRows) {
    const planned = finite(row.plannedEffect);
    const actual = finite(row.actualEffect);
    if (planned !== null && planned > 0 && actual !== null) {
      comparablePlanned += planned;
      comparableActual += actual;
    }
  }

  return {
    recommendationCount,
    startedCount,
    startRate: recommendationCount ? startedCount / recommendationCount : 0,
    completedCount,
    completionRate: recommendationCount ? completedCount / recommendationCount : 0,
    verifiedCount,
    verificationRate: recommendationCount ? verifiedCount / recommendationCount : 0,
    confirmedEffectCount,
    totalConfirmedEffect,
    averageTimeToStartHours: average(startDurations),
    averageTimeToCompleteHours: average(completeDurations),
    averageTimeToVerifyHours: average(verifyDurations),
    effectRealizationRatio: comparablePlanned > 0 ? comparableActual / comparablePlanned : null
  };
}
