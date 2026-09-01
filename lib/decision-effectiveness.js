function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function round(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function average(values) {
  const good = values.filter(Number.isFinite);
  return good.length ? good.reduce((a,b)=>a+b,0) / good.length : null;
}

export function calculateDecisionEffectiveness({ decisions = [], history = [] } = {}) {
  const uniqueHistory = [];
  const seen = new Set();
  for (const event of history) {
    const id = String(event?.eventId || '').trim();
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    uniqueHistory.push(event || {});
  }

  const byRule = new Map();
  for (const event of uniqueHistory) {
    const ruleId = String(event.ruleId || '').trim();
    if (!ruleId) continue;
    if (!byRule.has(ruleId)) byRule.set(ruleId, []);
    byRule.get(ruleId).push(event);
  }
  for (const events of byRule.values()) events.sort((a,b)=>(toMs(a.at) ?? Infinity) - (toMs(b.at) ?? Infinity));

  const recommendationCount = decisions.filter((d)=>String(d?.ruleId || '').trim()).length;
  let startedCount = 0;
  let completedCount = 0;
  let verifiedCount = 0;
  let confirmedEffectCount = 0;
  let totalConfirmedEffect = 0;
  let confirmedPlanned = 0;
  const startHours = [];
  const completeHours = [];
  const verifyHours = [];

  for (const decision of decisions) {
    const ruleId = String(decision?.ruleId || '').trim();
    if (!ruleId) continue;
    const events = byRule.get(ruleId) || [];
    const origin = events.find((e)=>toMs(e.at) !== null);
    const start = events.find((e)=>String(e.type || '') === 'Взято в работу');
    const complete = events.find((e)=>String(e.type || '') === 'Завершено');
    const verify = events.find((e)=>String(e.type || '') === 'Проверено');
    const status = String(decision.executionStatus || '').trim();
    const verification = String(decision.verificationStatus || 'Не проверено').trim();

    if (start || status === 'В работе' || status === 'Готово') startedCount += 1;
    if (complete || status === 'Готово') completedCount += 1;
    if (verify || (verification && verification !== 'Не проверено')) verifiedCount += 1;

    if (verification === 'Подтверждено') {
      const actual = numberOrNull(decision.actualEffect);
      if (actual !== null) {
        confirmedEffectCount += 1;
        totalConfirmedEffect += actual;
        const planned = numberOrNull(decision.plannedEffect);
        if (planned !== null && planned > 0) confirmedPlanned += planned;
      }
    }

    const originMs = toMs(origin?.at);
    const startMs = toMs(start?.at);
    const completeMs = toMs(complete?.at);
    const verifyMs = toMs(verify?.at);
    if (originMs !== null && startMs !== null && startMs >= originMs) startHours.push((startMs-originMs)/3600000);
    if (startMs !== null && completeMs !== null && completeMs >= startMs) completeHours.push((completeMs-startMs)/3600000);
    if (completeMs !== null && verifyMs !== null && verifyMs >= completeMs) verifyHours.push((verifyMs-completeMs)/3600000);
  }

  return {
    recommendationCount,
    startedCount,
    startRate: recommendationCount ? round(startedCount / recommendationCount) : 0,
    completedCount,
    completionRate: recommendationCount ? round(completedCount / recommendationCount) : 0,
    verifiedCount,
    verificationRate: recommendationCount ? round(verifiedCount / recommendationCount) : 0,
    confirmedEffectCount,
    totalConfirmedEffect: round(totalConfirmedEffect, 2) ?? 0,
    averageTimeToStartHours: round(average(startHours), 2),
    averageTimeToCompleteHours: round(average(completeHours), 2),
    averageTimeToVerifyHours: round(average(verifyHours), 2),
    effectRealizationRatio: confirmedPlanned > 0 ? round(totalConfirmedEffect / confirmedPlanned) : null
  };
}
