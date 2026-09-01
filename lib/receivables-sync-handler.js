import { buildReceivableRows, buildReceivableSummary } from './ashk-receivables.js';

const DETAIL_HEADERS = [
  'StudentId','GroupId','Филиал','Менеджер','Договор','Дата договора','Статус',
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

  return rows.reduce((acc, row) => {
    acc.contracts += 1;
    acc.salesSum += toNumber(row[7]);
    acc.debitSum += toNumber(row[8]);
    acc.debt += toNumber(row[9]);
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
  readSummary
} = {}) {
  if (typeof fetchCurrent !== 'function') throw new Error('fetchCurrent is required');
  if (typeof writeDetail !== 'function') throw new Error('writeDetail is required');
  if (typeof writeSummary !== 'function') throw new Error('writeSummary is required');
  if (typeof readDetail !== 'function') throw new Error('readDetail is required');
  if (typeof readSummary !== 'function') throw new Error('readSummary is required');

  return async function receivablesSyncHandler(req, res) {
    res.setHeader?.('Cache-Control', 'no-store');
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use GET' });
    }

    try {
      const { groups, contractsByGroup } = await fetchCurrent();
      const rows = buildReceivableRows(groups, contractsByGroup);
      const summary = buildReceivableSummary(rows);
      await writeDetail(detailValues(rows));
      await writeSummary(summaryValues(summary));

      const [detailReadback, summaryReadback] = await Promise.all([
        readDetail(),
        readSummary()
      ]);
      const detailMetrics = metricsFromDetail(detailReadback);
      const summaryMetrics = metricsFromSummary(summaryReadback);
      const verified = metricsMatch(detailMetrics, summary.total)
        && metricsMatch(summaryMetrics, summary.total);

      if (!verified) {
        console.error('receivables-staging-verification: mismatch');
        return res.status(502).json({
          ok: false,
          error: 'Receivables staging verification failed'
        });
      }

      console.log(JSON.stringify({
        event: 'receivables-staging-sync',
        contracts: summary.total.contracts,
        debt: summary.total.debt,
        managers: summary.byManager.length,
        branches: summary.byBranch.length,
        verified: true
      }));
      return res.status(200).json({
        ok: true,
        mode: 'staging_only',
        verified: true,
        total: summary.total,
        managers: summary.byManager.length,
        branches: summary.byBranch.length
      });
    } catch (error) {
      console.error('receivables-staging-sync:', error?.name || 'Error');
      return res.status(500).json({ ok: false, error: 'Receivables sync failed' });
    }
  };
}
