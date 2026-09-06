function text(value) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function normalizeTimestamp(value, field) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error(`${field} is invalid`);
    return value.toISOString();
  }
  if (typeof value !== 'string') throw new Error(`${field} is invalid`);

  const source = value.trim();
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/);
  if (!match) throw new Error(`${field} is invalid`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);

  if (month < 1 || month > 12
      || day < 1 || day > daysInMonth(year, month)
      || hour > 23
      || minute > 59
      || second > 59
      || offsetHour > 23
      || offsetMinute > 59) {
    throw new Error(`${field} is invalid`);
  }

  const parsed = new Date(source);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
}

function finiteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function nonNegativeFiniteNumber(value, field) {
  const normalized = finiteNumber(value, field);
  if (normalized < 0) throw new Error(`${field} must be non-negative`);
  return normalized;
}

function requiredRuleId(value) {
  const ruleId = text(value);
  if (!ruleId) throw new Error('ruleId is required');
  return ruleId;
}

function lexicalCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function compareQueueItems(left, right) {
  if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
  if (left.plannedEffect !== right.plannedEffect) {
    return right.plannedEffect - left.plannedEffect;
  }

  const completionDifference = Date.parse(left.completionTimestamp)
    - Date.parse(right.completionTimestamp);
  if (completionDifference !== 0) return completionDifference;
  return lexicalCompare(left.ruleId, right.ruleId);
}

export function buildDecisionVerificationQueue(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('input is required');
  }
  if (!Array.isArray(input.decisions)) throw new Error('decisions must be an array');
  if (!Array.isArray(input.history)) throw new Error('history must be an array');

  const now = normalizeTimestamp(input.now, 'now');
  const nowMs = Date.parse(now);
  const verificationSlaHours = nonNegativeFiniteNumber(
    input.verificationSlaHours,
    'verificationSlaHours'
  );

  const syntheticRuleIds = new Set();
  for (const value of input.decisions) {
    if (value?.synthetic === true) {
      const ruleId = text(value.ruleId);
      if (ruleId) syntheticRuleIds.add(ruleId);
    }
  }

  const realDecisions = [];
  const seenRuleIds = new Set();
  for (const value of input.decisions) {
    if (value?.synthetic === true) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('decision must be an object');
    }

    const ruleId = requiredRuleId(value.ruleId);
    if (seenRuleIds.has(ruleId)) throw new Error(`duplicate real ruleId: ${ruleId}`);
    seenRuleIds.add(ruleId);
    realDecisions.push({ value, ruleId });
  }

  for (const ruleId of seenRuleIds) syntheticRuleIds.delete(ruleId);

  const uniqueHistory = [];
  const seenEventIds = new Set();
  for (const event of input.history) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    const ruleId = text(event.ruleId);
    if (ruleId && syntheticRuleIds.has(ruleId)) continue;

    const eventId = text(event.eventId);
    if (!eventId || !ruleId || seenEventIds.has(eventId)) continue;
    seenEventIds.add(eventId);
    uniqueHistory.push({ event, ruleId });
  }

  const eligible = realDecisions.filter(({ value }) => {
    const executionStatus = text(value.executionStatus);
    const verificationStatus = text(value.verificationStatus);
    return executionStatus === 'Готово'
      && (verificationStatus === '' || verificationStatus === 'Не проверено');
  });

  const items = eligible.map(({ value, ruleId }) => {
    const plannedEffect = finiteNumber(value.plannedEffect, `plannedEffect for ${ruleId}`);
    const completionEvents = uniqueHistory.filter(({ event, ruleId: eventRuleId }) =>
      eventRuleId === ruleId && text(event.type) === 'Завершено'
    );

    let completionTimestamp;
    if (completionEvents.length) {
      const timestamps = completionEvents.map(({ event }) =>
        normalizeTimestamp(event.at, `completion timestamp for ${ruleId}`)
      );
      timestamps.sort((left, right) => Date.parse(left) - Date.parse(right));
      completionTimestamp = timestamps[0];
    } else {
      completionTimestamp = normalizeTimestamp(
        value.completedAt,
        `completion timestamp for ${ruleId}`
      );
    }

    const completionMs = Date.parse(completionTimestamp);
    if (completionMs > nowMs) {
      throw new Error(`completion timestamp for ${ruleId} is after now`);
    }

    const hoursWaiting = (nowMs - completionMs) / 3600000;
    const overdue = hoursWaiting > verificationSlaHours;
    const hoursOverdue = overdue ? hoursWaiting - verificationSlaHours : 0;
    const responsible = text(value.responsible) || null;

    return {
      ruleId,
      completionTimestamp,
      hoursWaiting,
      overdue,
      hoursOverdue,
      plannedEffect,
      responsible
    };
  });

  items.sort(compareQueueItems);
  const rankedItems = items.map((item, index) => ({
    ...item,
    priorityRank: index + 1
  }));

  return deepFreeze({
    now,
    verificationSlaHours,
    total: rankedItems.length,
    overdueCount: rankedItems.filter(item => item.overdue).length,
    historyEventCount: uniqueHistory.length,
    items: rankedItems
  });
}
