import { buildReceivableRows, buildReceivableSummary } from './ashk-receivables.js';
import { sanitizeFinanceStageFailure } from './finance-stage-result.js';

const DETAIL_HEADERS = [
  'StudentId','Курсант','GroupId','Филиал','Менеджер','Договор','Дата договора','Статус',
  'Продажи','Оплачено','Долг','Долг основной услуги','Основная услуга','Последняя оплата'
];

const SUMMARY_HEADERS = ['Тип','Объект','Договоров','Долг','Продажи','Оплачено'];

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? '')
    .replace(/\u00A0/g, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function detailValues(rows) {
  return [
    DETAIL_HEADERS,
    ...rows.map(row => [
      row.studentId,
      row.studentName,
      row.groupId,
      row.branch,
      row.manager,
      row.contractName,
      row.contractDate,
      row.state,
      row.salesSum,
      row.debitSum,
      row.debt,
      row.mainProductDebt,
      row.mainProductName,
      row.lastPaymentDate
    ])
  ];
}

function summaryValues(summary) {
  const rows = [
    SUMMARY_HEADERS,
    ['ИТОГО', '', summary.total.contracts, summary.total.debt, summary.total.salesSum, summary.total.debitSum]
  ];
  for (const item of summary.byManager) {
    rows.push(['МЕНЕДЖЕР', item.manager, item.contracts, item.debt, item.salesSum, item.debitSum]);
  }
  for (const item of summary.byBranch) {
    rows.push(['ФИЛИАЛ', item.branch, item.contracts, item.debt, item.salesSum, item.debitSum]);
  }
  return rows;
}

function metricsFromDetail(values) {
  const rows = (Array.isArray(values) ? values : [])
    .slice(1)
    .filter(row => Array.isArray(row) && row.some(value => value !== '' && value != null));

  const headers = Array.isArray(values?.[0]) ? values[0] : [];
  const idx = new Map(headers.map((name, index) => [String(name || '').trim(), index]));
  return rows.reduce((acc, row) => {
    acc.contracts += 1;
    acc.salesSum += toNumber(row[idx.get('Продажи')]);
    acc.debitSum += toNumber(row[idx.get('Оплачено')]);
    acc.debt += toNumber(row[idx.get('Долг')]);
    return acc;
  }, { contracts: 0, debt: 0, salesSum: 0, debitSum: 0 });
}

function metricsFromSummary(values) {
  const rows = Array.isArray(values) ? values : [];
  const totalRow = rows.find(row => String(row?.[0] ?? '').trim() === 'ИТОГО');
  if (!totalRow) return null;
  return {
    contracts: toNumber(totalRow[2]),
    debt: toNumber(totalRow[3]),
    salesSum: toNumber(totalRow[4]),
    debitSum: toNumber(totalRow[5])
  };
}

function metricsMatch(actual, expected) {
  if (!actual || !expected) return false;
  return Number(actual.contracts) === Number(expected.contracts)
    && Math.abs(roundMoney(actual.debt) - roundMoney(expected.debt)) <= 0.01
    && Math.abs(roundMoney(actual.salesSum) - roundMoney(expected.salesSum)) <= 0.01
    && Math.abs(roundMoney(actual.debitSum) - roundMoney(expected.debitSum)) <= 0.01;
}

export function createReceivablesSyncHandler({
  fetchCurrent,
  writeDetail,
  writeSummary,
  readDetail,
  readSummary,
  afterSourceVerified
} = {}) {
  if (typeof fetchCurrent !== 'function') throw new Error('fetchCurrent is required');
  if (typeof writeDetail !== 'function') throw new Error('writeDetail is required');
  if (typeof writeSummary !== 'function') throw new Error('writeSummary is required');
  if (typeof readDetail !== 'function') throw new Error('readDetail is required');
  if (typeof readSummary !== 'function') throw new Error('readSummary is required');
  if (afterSourceVerified != null && typeof afterSourceVerified !== 'function') throw new Error('afterSourceVerified must be a function');

  return async function receivablesSyncHandler(req, res) {
    res.setHeader?.('Cache-Control', 'no-store');
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use GET' });
    }

    let groups;
    let contractsByGroup;
    try {
      ({ groups, contractsByGroup } = await fetchCurrent());
    } catch (error) {
      const permanent = ['AUTH', 'VALIDATION'].includes(error?.errorClass);
      const failure = sanitizeFinanceStageFailure({
        statusCode: permanent ? error.statusCode : 502,
        errorClass: permanent ? error.errorClass : 'ASHK_FETCH'
      });
      return res.status(failure.statusCode).json(failure);
    }

    try {
      const rows = buildReceivableRows(groups, contractsByGroup);
      const summary = buildReceivableSummary(rows);
      try {
        await writeDetail(detailValues(rows));
        await writeSummary(summaryValues(summary));
      } catch {
        const failure = sanitizeFinanceStageFailure({ statusCode: 502, errorClass: 'SHEETS_WRITE' });
        return res.status(failure.statusCode).json(failure);
      }

      let detailReadback;
      let summaryReadback;
      try {
        [detailReadback, summaryReadback] = await Promise.all([
          readDetail(),
          readSummary()
        ]);
      } catch {
        const failure = sanitizeFinanceStageFailure({ statusCode: 502, errorClass: 'SHEETS_READBACK' });
        return res.status(failure.statusCode).json(failure);
      }
      const detailMetrics = metricsFromDetail(detailReadback);
      const summaryMetrics = metricsFromSummary(summaryReadback);
      const verified = metricsMatch(detailMetrics, summary.total)
        && metricsMatch(summaryMetrics, summary.total);

      if (!verified) {
        const failure = sanitizeFinanceStageFailure({ statusCode: 502, errorClass: 'READBACK_MISMATCH' });
        return res.status(failure.statusCode).json(failure);
      }

      try {
        if (afterSourceVerified) await afterSourceVerified({ groups, contractsByGroup, summary });
      } catch (error) {
        const failure = sanitizeFinanceStageFailure({ statusCode: 502, errorClass: error?.errorClass || 'SHEETS_WRITE' });
        return res.status(failure.statusCode).json(failure);
      }

      return res.status(200).json({
        ok: true,
        mode: 'staging_only',
        verified: true,
        total: summary.total,
        managers: summary.byManager.length,
        branches: summary.byBranch.length
      });
    } catch {
      const failure = sanitizeFinanceStageFailure({ statusCode: 500, errorClass: 'UNCLASSIFIED' });
      return res.status(failure.statusCode).json(failure);
    }
  };
}
