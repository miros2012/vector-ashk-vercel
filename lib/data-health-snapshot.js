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

function findRow(rows, left, right) {
  return (Array.isArray(rows) ? rows : []).find(
    row => text(row?.[0]) === left && text(row?.[1]) === right
  ) || null;
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
        marker: row?.[2] ?? null,
        warnAfterHours: finiteOrNull(row?.[4]),
        errorAfterHours: finiteOrNull(row?.[5]),
        status: text(row?.[6]).toUpperCase()
      };
    }
  }

  return { map, sources, source };
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
  const { map, sources, source } = rowsByMetric(rows);
  const tochkaDdsCoverageRow =
    findRow(source, 'Точка → ДДС', 'внешних операций не дошло — сегодня + backlog')
    || findRow(source, 'Точка → ДДС', 'внешних операций сегодня не дошло');

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
    },
    tochkaDds: {
      missingToday: tochkaDdsCoverageRow ? finiteOrNull(tochkaDdsCoverageRow?.[2]) : null
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
  if (snapshot.tochkaDds.missingToday !== null
      && (!Number.isInteger(snapshot.tochkaDds.missingToday) || snapshot.tochkaDds.missingToday < 0)) {
    consistencyErrors.push('tochka dds coverage count is invalid');
  }

  return {
    ...snapshot,
    valid: consistencyErrors.length === 0,
    consistencyErrors
  };
}

const DEFAULT_SOURCE_THRESHOLDS = Object.freeze({
  bank: Object.freeze({ warnAfterHours: 2, errorAfterHours: 4 }),
  payments: Object.freeze({ warnAfterHours: 2, errorAfterHours: 26 }),
  hours: Object.freeze({ warnAfterHours: 30, errorAfterHours: 54 }),
  receivables: Object.freeze({ warnAfterHours: 30, errorAfterHours: 54 }),
  forecast: Object.freeze({ warnAfterHours: 1, errorAfterHours: 24 }),
  transactions: Object.freeze({ warnAfterHours: 0.25, errorAfterHours: 2 })
});

const MAX_BANK_TRANSACTION_SKEW_HOURS = 0.25;

function hasMeaningfulText(value) {
  const valueText = text(value).toLowerCase();
  return Boolean(valueText && valueText !== 'нет' && valueText !== 'ok');
}

function normalizedSourceStatus(value) {
  const status = text(value).toUpperCase();
  if (status === 'ОШИБКА' || status === 'ERROR') return 'ERROR';
  if (status === 'ЗАДЕРЖКА' || status === 'WARNING' || status === 'DELAY') return 'WARNING';
  if (status === 'OK') return 'OK';
  return '';
}

function sourceThresholds(sourceKey, source, overrides = {}) {
  const defaults = DEFAULT_SOURCE_THRESHOLDS[sourceKey];
  const override = overrides?.[sourceKey];
  const overrideObject = override && typeof override === 'object' ? override : {};
  const legacyErrorOverride = typeof override === 'number' ? finiteOrNull(override) : null;

  let warnAfterHours = finiteOrNull(source?.warnAfterHours);
  if (warnAfterHours === null) warnAfterHours = finiteOrNull(overrideObject.warnAfterHours);
  if (warnAfterHours === null) warnAfterHours = defaults.warnAfterHours;

  let errorAfterHours = finiteOrNull(source?.errorAfterHours);
  if (errorAfterHours === null) errorAfterHours = finiteOrNull(overrideObject.errorAfterHours);
  if (errorAfterHours === null) errorAfterHours = legacyErrorOverride;
  if (errorAfterHours === null) errorAfterHours = defaults.errorAfterHours;

  return { warnAfterHours, errorAfterHours };
}

function markerPresent(value) {
  return value !== null && value !== undefined && text(value) !== '';
}

export function evaluateDataHealthSnapshot(snapshot = {}, thresholds = {}) {
  const staleCoreSources = [];
  const delayedSources = [];
  const missingCoreSources = [];
  const consistencyErrors = Array.isArray(snapshot?.consistencyErrors)
    ? [...snapshot.consistencyErrors]
    : [];

  for (const sourceKey of Object.keys(DEFAULT_SOURCE_THRESHOLDS)) {
    const source = snapshot?.sources?.[sourceKey];
    const ageHours = finiteOrNull(source?.ageHours);
    if (!source || ageHours === null || !markerPresent(source?.marker)) {
      missingCoreSources.push(sourceKey);
      continue;
    }

    const { warnAfterHours, errorAfterHours } = sourceThresholds(sourceKey, source, thresholds);
    if (warnAfterHours < 0 || errorAfterHours < warnAfterHours) {
      staleCoreSources.push(sourceKey);
      consistencyErrors.push(`source thresholds invalid:${sourceKey}`);
      continue;
    }

    const explicitStatus = normalizedSourceStatus(source?.status);
    if (ageHours < 0 || ageHours > errorAfterHours || explicitStatus === 'ERROR') {
      staleCoreSources.push(sourceKey);
      continue;
    }
    if (ageHours > warnAfterHours || explicitStatus === 'WARNING') {
      delayedSources.push(sourceKey);
    }
  }

  const bankAgeHours = finiteOrNull(snapshot?.sources?.bank?.ageHours);
  const transactionAgeHours = finiteOrNull(snapshot?.sources?.transactions?.ageHours);
  if (bankAgeHours !== null && transactionAgeHours !== null
      && transactionAgeHours - bankAgeHours > MAX_BANK_TRANSACTION_SKEW_HOURS) {
    staleCoreSources.push('transactions');
    consistencyErrors.push('bank transaction journal lags live balance');
  }

  const missingDdsToday = finiteOrNull(snapshot?.tochkaDds?.missingToday);
  const ddsIncomplete = missingDdsToday !== null && missingDdsToday > 0;
  if (ddsIncomplete) consistencyErrors.push('tochka dds coverage incomplete');

  const uniqueStaleCoreSources = [...new Set(staleCoreSources)];
  const uniqueDelayedSources = [...new Set(delayedSources)]
    .filter(sourceKey => !uniqueStaleCoreSources.includes(sourceKey));
  const uniqueMissingCoreSources = [...new Set(missingCoreSources)];
  const uniqueConsistencyErrors = [...new Set(consistencyErrors)];

  const warnings = uniqueDelayedSources.map(sourceKey => `source-delay:${sourceKey}`);
  if (text(snapshot?.systemStatus).toUpperCase() === 'RISK') warnings.push('financial-risk');
  if (hasMeaningfulText(snapshot?.cash?.staleBranches)) warnings.push('cash-stale');
  if (hasMeaningfulText(snapshot?.cash?.reviewBranches)) warnings.push('cash-review');

  const uniqueWarnings = [...new Set(warnings)];
  const blocked = snapshot?.valid !== true
    || uniqueStaleCoreSources.length > 0
    || uniqueMissingCoreSources.length > 0
    || ddsIncomplete;

  return {
    ok: !blocked,
    status: blocked ? 'BLOCKED' : uniqueWarnings.length ? 'WARNING' : 'OK',
    staleCoreSources: uniqueStaleCoreSources,
    missingCoreSources: uniqueMissingCoreSources,
    warnings: uniqueWarnings,
    consistencyErrors: uniqueConsistencyErrors
  };
}
