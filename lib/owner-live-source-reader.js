import { parseDataHealthSnapshot, evaluateDataHealthSnapshot } from './data-health-snapshot.js';
import { decisionFromSheetRow } from './decision-sheet-store.js';
import { createOwnerForecastSheetAdapter } from './owner-forecast-sheet-adapter.js';
import { runOwnerPackageStage } from './owner-package-stage.js';

const BUSINESS_TIME_ZONE = 'Asia/Yekaterinburg';

const OWNER_LIVE_RANGES = Object.freeze({
  dataHealth: "'Data Health Snapshot'!A1:L40",
  sales: "'РОП_Штаб_Утро'!A1:I500",
  receivables: "'АШК_Дебиторка_Свод__vercel'!A1:F2",
  obligations: "'Обязательства'!A1:Q500",
  adjustments: "'Корректировки обязательств'!A1:J500",
  drivingFund: "'Фонд вождения'!A21:J30",
  decisions: "'Решения'!A1:V200",
  history: "'История решений'!A1:K1000"
});

const OBLIGATION_IDENTITY_COLUMNS = Object.freeze([0, 1, 2, 6, 7, 8, 9, 10, 11, 12, 13]);
const OBLIGATION_AMOUNT_COLUMNS = Object.freeze([3, 4, 5, 14, 15, 16]);

function text(value) {
  return String(value ?? '').trim();
}

function finiteOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requiredFinite(value, field) {
  const number = finiteOrNull(value);
  if (number === null) throw new Error(`${field} must be finite`);
  return Object.is(number, -0) ? 0 : number;
}

function requiredNonNegativeFinite(value, field) {
  const number = requiredFinite(value, field);
  if (number < 0) throw new Error(`${field} must be non-negative`);
  return number;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function tyumenBusinessDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('owner live now is invalid');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function assertHeader(values, expected, label) {
  const header = Array.isArray(values?.[0]) ? values[0] : [];
  for (let index = 0; index < expected.length; index += 1) {
    if (text(header[index]) !== expected[index]) {
      throw new Error(`${label} header is invalid at column ${index + 1}`);
    }
  }
}

function parseSales(values, businessDate) {
  assertHeader(values, [
    'Срез',
    'Дата отчёта',
    'Уровень',
    'Менеджер',
    'Филиал',
    'План филиала на месяц',
    'План филиала к дате',
    'Факт филиала за день',
    'Факт филиала с начала месяца'
  ], 'owner live sales');

  const matches = values.slice(1).filter(row =>
    text(row?.[0]) === 'СЕГОДНЯ — НА СЕЙЧАС'
    && text(row?.[1]) === businessDate
    && text(row?.[2]) === 'ГОРОД'
  );
  if (matches.length === 0) throw new Error('owner live sales city row is missing');
  if (matches.length !== 1) throw new Error('owner live sales city row is ambiguous');

  const row = matches[0];
  return {
    monthlyPlan: requiredFinite(row[5], 'owner live sales monthlyPlan'),
    planToDate: requiredFinite(row[6], 'owner live sales planToDate'),
    dayFact: requiredFinite(row[7], 'owner live sales dayFact'),
    monthFact: requiredFinite(row[8], 'owner live sales monthFact')
  };
}

function parseReceivables(values) {
  assertHeader(values, ['Тип', 'Объект', 'Договоров', 'Долг', 'Продажи', 'Оплачено'], 'owner live receivables');
  const totals = values.slice(1).filter(row => text(row?.[0]) === 'ИТОГО');
  if (totals.length === 0) throw new Error('owner live receivables total row is missing');
  if (totals.length !== 1) throw new Error('owner live receivables total row is ambiguous');

  const row = totals[0];
  const contracts = requiredFinite(row[2], 'owner live receivables contracts');
  if (!Number.isInteger(contracts) || contracts < 0) {
    throw new Error('owner live receivables contracts must be a non-negative integer');
  }
  return {
    contracts,
    debt: requiredNonNegativeFinite(row[3], 'owner live receivables debt'),
    sales: requiredNonNegativeFinite(row[4], 'owner live receivables sales'),
    paid: requiredNonNegativeFinite(row[5], 'owner live receivables paid')
  };
}

function isClosedObligationStatus(status) {
  const normalized = text(status).toLowerCase();
  return normalized.includes('оплачен') || normalized.includes('закрыт');
}

function isUnconfirmedObligationStatus(status) {
  const normalized = text(status);
  return normalized === 'Оценка' || normalized.startsWith('Требует');
}

export function isMeaningfulObligationRow(row) {
  if (!Array.isArray(row)) return false;
  if (OBLIGATION_IDENTITY_COLUMNS.some(index => text(row[index]) !== '')) return true;

  return OBLIGATION_AMOUNT_COLUMNS.some(index => {
    const value = row[index];
    if (value === '' || value === null || value === undefined) return false;
    const number = Number(value);
    if (!Number.isFinite(number)) return text(value) !== '';
    return number !== 0;
  });
}

function parseObligations(values, adjustmentValues) {
  assertHeader(values, [
    'Дата','Обязательство','Категория','Сумма план (net)','Сумма факт','Остаток','Приоритет','Статус',
    'Источник','Доверие','Ответственный','Комментарий','Регулярное','ID','Gross обязательство',
    'Корректировки net','Net cash outflow'
  ], 'owner live obligations');
  assertHeader(adjustmentValues, [
    'ID корректировки','ID обязательства','Тип корректировки','Направление','Сумма','Статус','Доверие',
    'Источник','Комментарий','Дата оценки'
  ], 'owner live obligation adjustments');

  let openCashNeed = 0;
  let confirmedCashNeed = 0;
  let unconfirmedCashNeed = 0;
  let unconfirmedAmountMissing = false;
  const obligationIds = new Set();

  const rows = values.slice(1)
    .filter(row => isMeaningfulObligationRow(row))
    .map((row, index) => {
      const id = text(row[13]);
      if (!id) throw new Error(`owner live obligation id is missing at row ${index + 2}`);
      if (obligationIds.has(id)) throw new Error(`duplicate obligation id: ${id}`);
      obligationIds.add(id);

      const status = text(row[7]);
      if (!status) throw new Error(`owner live obligation status is missing for ${id}`);
      const closed = isClosedObligationStatus(status);
      const unconfirmed = !closed && isUnconfirmedObligationStatus(status);
      const netCashOutflow = finiteOrNull(row[16]);

      if (!closed && netCashOutflow === null) {
        if (unconfirmed) {
          unconfirmedAmountMissing = true;
        } else {
          throw new Error(`owner live obligation net cash outflow is missing for ${id}`);
        }
      }

      const cashNeed = !closed && netCashOutflow !== null && netCashOutflow > 0
        ? netCashOutflow
        : 0;
      openCashNeed += cashNeed;
      if (unconfirmed) unconfirmedCashNeed += cashNeed;
      else confirmedCashNeed += cashNeed;

      return {
        id,
        dueDate: row[0] ?? null,
        name: text(row[1]),
        category: text(row[2]),
        status,
        source: text(row[8]),
        confidence: text(row[9]),
        closed,
        unconfirmed,
        netCashOutflow,
        cashNeed
      };
    });

  const adjustmentIds = new Set();
  const adjustments = adjustmentValues.slice(1)
    .filter(row => Array.isArray(row) && row.some(value => text(value) !== ''))
    .map((row, index) => {
      const id = text(row[0]);
      const obligationId = text(row[1]);
      if (!id || !obligationId) {
        throw new Error(`owner live obligation adjustment id is invalid at row ${index + 2}`);
      }
      if (adjustmentIds.has(id)) throw new Error(`duplicate obligation adjustment id: ${id}`);
      adjustmentIds.add(id);
      return {
        id,
        obligationId,
        type: text(row[2]),
        direction: text(row[3]),
        amount: requiredFinite(row[4], `owner live obligation adjustment amount for ${id}`),
        status: text(row[5]),
        confidence: text(row[6]),
        source: text(row[7])
      };
    });

  return {
    rows,
    adjustments,
    openCashNeed: Math.round(openCashNeed * 100) / 100,
    confirmedCashNeed: Math.round(confirmedCashNeed * 100) / 100,
    unconfirmedCashNeed: Math.round(unconfirmedCashNeed * 100) / 100,
    unconfirmedAmountMissing
  };
}

function parseDrivingFund(values) {
  const byLabel = new Map();
  for (const row of Array.isArray(values) ? values : []) {
    const label = text(row?.[0]);
    if (!label) continue;
    if (byLabel.has(label)) throw new Error(`owner live driving fund label is duplicated: ${label}`);
    byLabel.set(label, row);
  }

  const valueFor = label => {
    const row = byLabel.get(label);
    if (!row) throw new Error(`owner live driving fund label is missing: ${label}`);
    return requiredFinite(row[8], `owner live driving fund ${label}`);
  };

  return {
    requiredReserve: valueFor('Необходимый резерв фонда, ₽'),
    liveBalance: valueFor('LIVE остаток фонда вождения, ₽'),
    deficit: valueFor('Дефицит фонда (+) / избыток (-), ₽')
  };
}

function parseDecisions(values) {
  assertHeader(values, ['Rule ID'], 'owner live decisions');
  const ruleIds = new Set();
  return values.slice(1)
    .filter(row => text(row?.[0]))
    .map((row, index) => {
      const decision = decisionFromSheetRow(row, index + 2);
      if (ruleIds.has(decision.ruleId)) throw new Error(`duplicate decision rule id: ${decision.ruleId}`);
      ruleIds.add(decision.ruleId);
      return {
        ...decision,
        responsible: text(row[6]) || null,
        source: text(row[14]) || null,
        linkedObject: text(row[15]) || null,
        synthetic: decision.ruleId.startsWith('DEC-SYNTH-')
      };
    });
}

function parseHistory(values) {
  assertHeader(values, ['Event ID', 'Rule ID', 'Событие', 'Дата/время'], 'owner live decision history');
  const eventIds = new Set();
  return values.slice(1)
    .filter(row => text(row?.[0]))
    .map((row, index) => {
      const eventId = text(row[0]);
      const ruleId = text(row[1]);
      if (!ruleId) throw new Error(`owner live decision history ruleId is missing at row ${index + 2}`);
      if (eventIds.has(eventId)) throw new Error(`duplicate decision history event id: ${eventId}`);
      eventIds.add(eventId);
      const plannedEffect = finiteOrNull(row[7]);
      const actualEffect = finiteOrNull(row[8]);
      return {
        eventId,
        ruleId,
        type: text(row[2]),
        at: row[3] ?? null,
        before: text(row[4]),
        after: text(row[5]),
        actor: text(row[6]) || null,
        plannedEffect: plannedEffect ?? 0,
        actualEffect,
        evidence: text(row[9]) || null,
        comment: text(row[10]) || null,
        synthetic: ruleId.startsWith('DEC-SYNTH-')
      };
    });
}

function matricesFromBatch(response) {
  const valueRanges = response?.data?.valueRanges;
  if (!Array.isArray(valueRanges) || valueRanges.length !== Object.keys(OWNER_LIVE_RANGES).length) {
    throw new Error('owner live source matrices unavailable');
  }
  const result = {};
  const entries = Object.entries(OWNER_LIVE_RANGES);
  for (let index = 0; index < entries.length; index += 1) {
    const [key] = entries[index];
    const values = valueRanges[index]?.values;
    if (!Array.isArray(values)) throw new Error(`owner live source matrix unavailable: ${key}`);
    result[key] = values;
  }
  return result;
}

export function createOwnerLiveSourceReader({ sheets, spreadsheetId, now = () => new Date() }) {
  if (!sheets?.spreadsheets?.values?.get || !sheets?.spreadsheets?.values?.batchGet) {
    throw new Error('owner live read-only Sheets client is required');
  }
  if (!text(spreadsheetId)) throw new Error('owner live spreadsheetId is required');
  if (typeof now !== 'function') throw new Error('owner live now must be a function');

  const forecast = createOwnerForecastSheetAdapter({ sheets, spreadsheetId });

  return {
    async readOwnerLiveFacts() {
      const businessDate = tyumenBusinessDate(now());
      const [forecastFacts, batchResponse] = await Promise.all([
        runOwnerPackageStage('FORECAST_READ', () => forecast.readOwnerForecast()),
        runOwnerPackageStage('BATCH_READ', () => sheets.spreadsheets.values.batchGet({
          spreadsheetId,
          ranges: Object.values(OWNER_LIVE_RANGES),
          valueRenderOption: 'UNFORMATTED_VALUE'
        }))
      ]);
      const matrices = await runOwnerPackageStage(
        'MATRICES_PARSE',
        () => matricesFromBatch(batchResponse)
      );
      const health = await runOwnerPackageStage('DATA_HEALTH_PARSE', () => {
        const snapshot = parseDataHealthSnapshot(matrices.dataHealth);
        return {
          snapshot,
          evaluation: evaluateDataHealthSnapshot(snapshot)
        };
      });
      const sales = await runOwnerPackageStage(
        'SALES_PARSE',
        () => parseSales(matrices.sales, businessDate)
      );
      const receivables = await runOwnerPackageStage(
        'RECEIVABLES_PARSE',
        () => parseReceivables(matrices.receivables)
      );
      const obligations = await runOwnerPackageStage(
        'OBLIGATIONS_PARSE',
        () => parseObligations(matrices.obligations, matrices.adjustments)
      );
      const drivingFund = await runOwnerPackageStage(
        'DRIVING_FUND_PARSE',
        () => parseDrivingFund(matrices.drivingFund)
      );
      const decisions = await runOwnerPackageStage(
        'DECISIONS_PARSE',
        () => parseDecisions(matrices.decisions)
      );
      const history = await runOwnerPackageStage(
        'HISTORY_PARSE',
        () => parseHistory(matrices.history)
      );

      return deepFreeze({
        businessDate,
        forecast: forecastFacts,
        dataHealth: { ...health.evaluation, snapshot: health.snapshot },
        sales,
        receivables,
        obligations,
        drivingFund,
        decisions,
        history
      });
    }
  };
}