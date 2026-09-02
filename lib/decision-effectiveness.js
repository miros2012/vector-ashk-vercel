function finiteNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timeMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function hoursBetween(from, to) {
  const fromMs = timeMs(from);
  const toMs = timeMs(to);
  if (fromMs === null || toMs === null || toMs < fromMs) return null;
  return (toMs - fromMs) / 3600000;
}

function dedupeHistory(history = []) {
  const seen = new Set();
  const result = [];
  for (const event of history) {
    const eventId = String(event?.eventId || '').trim();
    const ruleId = String(event?.ruleId || '').trim();
    const at = String(event?.at || '').trim();
    if (!eventId || !ruleId || timeMs(at) === null || seen.has(eventId)) continue;
    seen.add(eventId);
    result.push({ ...event, eventId, ruleId, at });
  }
  return result;
}

function eventFor(events, type) {
  return events
    .filter((event) => String(event.type || '').trim() === type)
    .sort((a, b) => timeMs(a.at) - timeMs(b.at))[0] || null;
}

export function calculateDecisionEffectiveness({ decisions = [], history = [] } = {}) {
  const normalizedDecisions = decisions.filter((decision) => String(decision?.ruleId || '').trim());
  const uniqueHistory = dedupeHistory(history);
  const byRule = new Map();
  for (const event of uniqueHistory) {
    const list = byRule.get(event.ruleId) || [];
    list.push(event);
    byRule.set(event.ruleId, list);
  }
  for (const list of byRule.values()) list.sort((a, b) => timeMs(a.at) - timeMs(b.at));

  const recommendationCount = normalizedDecisions.length;
  const startedCount = normalizedDecisions.filter((decision) => ['В работе', 'Готово'].includes(String(decision.executionStatus || '').trim())).length;
  const completedCount = normalizedDecisions.filter((decision) => String(decision.executionStatus || '').trim() === 'Готово').length;
  const verifiedCount = normalizedDecisions.filter((decision) => {
    const status = String(decision.verificationStatus || '').trim();
    return status && status !== 'Не проверено';
  }).length;

  const confirmed = normalizedDecisions.filter((decision) =>
    String(decision.verificationStatus || '').trim() === 'Подтверждено' && finiteNumber(decision.actualEffect) !== null
  );
  const confirmedEffectCount = confirmed.length;
  const totalConfirmedEffect = confirmed.reduce((sum, decision) => sum + finiteNumber(decision.actualEffect), 0);

  const startDurations = [];
  const completeDurations = [];
  const verifyDurations = [];
  for (const decision of normalizedDecisions) {
    const ruleId = String(decision.ruleId).trim();
    const events = byRule.get(ruleId) || [];
    const start = eventFor(events, 'Взято в работу');
    const complete = eventFor(events, 'Завершено');
    const verify = eventFor(events, 'Проверено');

    if (start) {
      const prior = events.filter((event) => timeMs(event.at) < timeMs(start.at));
      if (prior.length) {
        const duration = hoursBetween(prior[0].at, start.at);
        if (duration !== null) startDurations.push(duration);
      }
    }
    if (start && complete) {
      const duration = hoursBetween(start.at, complete.at);
      if (duration !== null) completeDurations.push(duration);
    }
    if (complete && verify) {
      const duration = hoursBetween(complete.at, verify.at);
      if (duration !== null) verifyDurations.push(duration);
    }
  }

  let effectRealizationRatio = null;
  const comparable = confirmed.filter((decision) => {
    const planned = finiteNumber(decision.plannedEffect);
    return planned !== null && planned > 0;
  });
  const comparablePlanned = comparable.reduce((sum, decision) => sum + finiteNumber(decision.plannedEffect), 0);
  if (comparablePlanned > 0) {
    const comparableActual = comparable.reduce((sum, decision) => sum + finiteNumber(decision.actualEffect), 0);
    effectRealizationRatio = comparableActual / comparablePlanned;
  }

  return {
    recommendationCount,
    startedCount,
    completedCount,
    verifiedCount,
    confirmedEffectCount,
    totalConfirmedEffect,
    startRate: recommendationCount ? startedCount / recommendationCount : 0,
    completionRate: startedCount ? completedCount / startedCount : 0,
    verificationRate: completedCount ? verifiedCount / completedCount : 0,
    averageTimeToStartHours: average(startDurations),
    averageTimeToCompleteHours: average(completeDurations),
    averageTimeToVerifyHours: average(verifyDurations),
    effectRealizationRatio,
    historyEventCount: uniqueHistory.length
  };
}
