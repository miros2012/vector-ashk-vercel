export const MASTER_PAYROLL_RATE_MODEL = Object.freeze({
  'Основное вождение (120 минут)': Object.freeze({ mode: 'hour', rate: 383, group: 'B' }),
  'Основное вождение (160 минут)': Object.freeze({ mode: 'hour', rate: 383, group: 'B' }),
  'Доп. часы кат В (120 минут)': Object.freeze({ mode: 'event', rate: 1500, group: 'B' }),
  'Доп часы кат.В (90 минут)': Object.freeze({ mode: 'event', rate: 1500, group: 'B' }),
  'Внутренний экзамен город': Object.freeze({ mode: 'event', rate: 200, group: 'B' }),
  Tsl: Object.freeze({ mode: 'event', rate: 574.5, group: 'B' }),
  'Мото': Object.freeze({ mode: 'event', rate: 450, group: 'MOTO' }),
  'Дополнительное вождение МОТО': Object.freeze({ mode: 'event', rate: 650, group: 'EXTRA_MOTO' }),
  'Тренажер': Object.freeze({ mode: 'event', rate: 150, group: 'TRAINER' })
});

function asFiniteHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) {
    throw new TypeError(`Invalid academicHours: ${value}`);
  }
  return hours;
}

function rowGross(row, rule) {
  return rule.mode === 'hour'
    ? asFiniteHours(row.academicHours) * rule.rate
    : rule.rate;
}

export function calculateVerifiedGross(rows, rateModel = MASTER_PAYROLL_RATE_MODEL) {
  if (!Array.isArray(rows)) {
    throw new TypeError('rows must be an array');
  }

  const masterMap = new Map();
  const blockers = [];
  let gross = 0;

  for (const row of rows) {
    const rule = rateModel[row.sessionTypeName];
    if (!rule) {
      blockers.push({
        employeeId: row.employeeId ?? null,
        masterName: row.masterName ?? '',
        sessionTypeName: row.sessionTypeName ?? '',
        eventKey: row.eventKey ?? null,
        reason: 'UNKNOWN_SESSION_TYPE'
      });
      continue;
    }

    const masterKey = String(row.employeeId ?? '').trim();
    if (!masterKey) {
      blockers.push({
        employeeId: null,
        masterName: row.masterName ?? '',
        sessionTypeName: row.sessionTypeName ?? '',
        eventKey: row.eventKey ?? null,
        reason: 'MISSING_EMPLOYEE_ID'
      });
      continue;
    }

    const academicHours = asFiniteHours(row.academicHours);
    const amount = rowGross({ ...row, academicHours }, rule);

    let master = masterMap.get(masterKey);
    if (!master) {
      master = {
        masterKey,
        employeeId: masterKey,
        masterName: row.masterName ?? '',
        gross: 0,
        components: {}
      };
      masterMap.set(masterKey, master);
    }

    if (!master.components[row.sessionTypeName]) {
      master.components[row.sessionTypeName] = {
        mode: rule.mode,
        rate: rule.rate,
        group: rule.group,
        events: 0,
        academicHours: 0,
        gross: 0
      };
    }

    const component = master.components[row.sessionTypeName];
    component.events += 1;
    component.academicHours += academicHours;
    component.gross += amount;
    master.gross += amount;
    gross += amount;
  }

  const masters = [...masterMap.values()].sort((a, b) =>
    a.masterName.localeCompare(b.masterName, 'ru') || a.masterKey.localeCompare(b.masterKey)
  );

  return {
    masters,
    totals: {
      masters: masters.length,
      events: rows.length - blockers.length,
      gross
    },
    blockers
  };
}
