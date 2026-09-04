function text(value) {
  return String(value ?? '').trim();
}

function finiteOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function recordKey(contour, metric) {
  return `${text(contour)}\u0000${text(metric)}`;
}

function findHeaderIndex(rows, left, right) {
  return rows.findIndex(row => text(row?.[0]) === left && text(row?.[1]) === right);
}

function rowsByMetric(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const normalizedHeader = findHeaderIndex(source, 'Контур', 'Метрика');
  const operationalHeader = findHeaderIndex(source, 'Источник', 'Что проверяем');

  if (normalizedHeader < 0 && operationalHeader < 0) {
    throw new Error('Data Health Snapshot header is invalid');
  }

  const start = normalizedHeader >= 0 ? normalizedHeader + 1 : operationalHeader + 1;
  const map = new Map();
  for (const row of source.slice(start)) {
    const contour = text(row?.[0]);
    const metric = text(row?.[1]);
    if (!contour || !metric) continue;
    if (contour === 'Филиал' && metric === 'Последняя дата журнала') break;
    map.set(recordKey(contour, metric), row);
  }

  const sources = {};
  if (operationalHeader >= 0) {
    const sourceRows = source.slice(operationalHeader + 1);
    const sourceDefinitions = [
      ['bank', 'Точка API'],
      ['payments', 'АШК оплаты'],
      ['hours', 'АШК часы'],
      ['receivables', 'АШК дебиторка / РОП'],
      ['forecast', 'Прогноз 30 дней'],
      ['transactions', 'Точка операции']
    ];
    for (const [key, label] of sourceDefinitions) {
      const row = sourceRows.find(candidate => text(candidate?.[0]) === label);
      if (!row) continue;
      sources[key] = {
        ageHours: finiteOrNull(row?.[3]),
        marker: row?.[2] ?? null
      };
    }
  }

  return { map, sources };
}

function metricValue(map, contour, metric) {
  return map.get(recordKey(contour, metric))?.[2] ?? null;
}

function metricText(map, contour, metric) {
  return text(metricValue(map, contour, metric));
}

function metricNumber(map, contour, metric) {
  return finiteOrNull(metricValue(map, contour, metric));
}

export function parseDataHealthSnapshot(rows = []) {
  const { map, sources } = rowsByMetric(rows);

  const cash = {
    branchesTotal: metricNumber(map, 'Касса', 'Филиалов всего'),
    freshFacts: metricNumber(map, 'Касса', 'Свежих фактов ≤2 дн.'),
    staleFacts: metricNumber(map, 'Касса', 'Устаревших / нет факта'),
    reviewRows: metricNumber(map, 'Касса', 'Строк с расхождением / проверкой'),
    availableCash: metricNumber(map, 'Касса', 'Фактическая наличность по доступным фактам, ₽'),
    latestRowsNotTransferred: metricNumber(map, 'Касса', 'Последних строк не перенесено'),
    staleBranches: metricText(map, 'Касса', 'Устаревшие филиалы'),
    reviewBranches: metricText(map, 'Касса', 'Филиалы с расхождением / проверкой')
  };

  const snapshot = {
    systemStatus: metricText(map, 'Система', 'Общий статус') || 'UNKNOWN',
    sources,
    cash,
    bank: {
      liveAccounts: metricText(map, 'Банк', 'Точка — LIVE счета'),
      workingBalance: metricNumber(map, 'Банк', 'Рабочий баланс, ₽')
    },
    obligations: {
      unconfirmed: metricNumber(map, 'Обязательства', 'Неподтверждённых')
    },
    forecast: {
      cashGap30d: metricNumber(map, 'Прогноз', 'Кассовый разрыв 30 дней, ₽')
    },
    sales: {
      ropDeficitToDate: metricNumber(map, 'Продажи', 'РОП — дефицит к плану на дату, ₽')
    },
    receivables: {
      current: metricNumber(map, 'Дебиторка', 'Текущая дебиторка, ₽')
    },
    drivingFund: {
      deficit: metricNumber(map, 'Фонд вождения', 'Дефицит фонда, ₽')
    }
  };

  const consistencyErrors = [];
  if (cash.branchesTotal !== null && cash.freshFacts !== null && cash.staleFacts !== null
      && Math.abs(cash.branchesTotal - cash.freshFacts - cash.staleFacts) > 0.001) {
    consistencyErrors.push('cash freshness totals do not reconcile');
  }
  if (cash.branchesTotal !== null && (!Number.isInteger(cash.branchesTotal) || cash.branchesTotal < 0)) {
    consistencyErrors.push('cash branch count is invalid');
  }
  if (cash.latestRowsNotTransferred !== null && cash.latestRowsNotTransferred < 0) {
    consistencyErrors.push('cash transfer count is invalid');
  }

  return {
    ...snapshot,
    valid: consistencyErrors.length === 0,
    consistencyErrors
  };
}

const DEFAULT_SOURCE_MAX_AGE_HOURS = Object.freeze({
  bank: 2,
  payments: 2,
  hours: 30,
  receivables: 26,
  forecast: 26,
  transactions: 2
});

const MAX_BANK_TRANSACTION_SKEW_HOURS = 0.25;

function hasMeaningfulText(value) {
  const valueText = text(value).toLowerCase();
  return Boolean(valueText && valueText !== 'нет' && valueText !== 'ok');
}

export function evaluateDataHealthSnapshot(snapshot = {}, thresholds = DEFAULT_SOURCE_MAX_AGE_HOURS) {
  const staleCoreSources = [];
  const missingCoreSources = [];
  const consistencyErrors = Array.isArray(snapshot?.consistencyErrors)
    ? [...snapshot.consistencyErrors]
    : [];

  for (const [sourceKey, defaultLimit] of Object.entries(DEFAULT_SOURCE_MAX_AGE_HOURS)) {
    const source = snapshot?.sources?.[sourceKey];
    const ageHours = finiteOrNull(source?.ageHours);
    const configuredLimit = finiteOrNull(thresholds?.[sourceKey]);
    const limit = configuredLimit === null || configuredLimit < 0 ? defaultLimit : configuredLimit;

    if (!source || ageHours === null) {
      missingCoreSources.push(sourceKey);
      continue;
    }
    if (ageHours < 0 || ageHours > limit) staleCoreSources.push(sourceKey);
  }

  const bankAgeHours = finiteOrNull(snapshot?.sources?.bank?.ageHours);
  const transactionAgeHours = finiteOrNull(snapshot?.sources?.transactions?.ageHours);
  if (bankAgeHours !== null && transactionAgeHours !== null
      && transactionAgeHours - bankAgeHours > MAX_BANK_TRANSACTION_SKEW_HOURS) {
    staleCoreSources.push('transactions');
    consistencyErrors.push('bank transaction journal lags live balance');
  }

  const uniqueStaleCoreSources = [...new Set(staleCoreSources)];
  const uniqueMissingCoreSources = [...new Set(missingCoreSources)];
  const uniqueConsistencyErrors = [...new Set(consistencyErrors)];

  const warnings = [];
  if (text(snapshot?.systemStatus).toUpperCase() === 'RISK') warnings.push('financial-risk');
  if (hasMeaningfulText(snapshot?.cash?.staleBranches)) warnings.push('cash-stale');
  if (hasMeaningfulText(snapshot?.cash?.reviewBranches)) warnings.push('cash-review');

  const blocked = snapshot?.valid !== true
    || uniqueStaleCoreSources.length > 0
    || uniqueMissingCoreSources.length > 0;

  return {
    ok: !blocked,
    status: blocked ? 'BLOCKED' : warnings.length ? 'WARNING' : 'OK',
    staleCoreSources: uniqueStaleCoreSources,
    missingCoreSources: uniqueMissingCoreSources,
    warnings,
    consistencyErrors: uniqueConsistencyErrors
  };
}
