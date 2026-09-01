import { buildReceivableRows, buildReceivableSummary } from './ashk-receivables.js';

const DETAIL_HEADERS = [
  'StudentId','GroupId','Филиал','Менеджер','Договор','Дата договора','Статус',
  'Продажи','Оплачено','Долг','Долг основной услуги','Основная услуга','Последняя оплата'
];

const SUMMARY_HEADERS = ['Тип','Объект','Договоров','Долг','Продажи','Оплачено'];

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

export function createReceivablesSyncHandler({ fetchCurrent, writeDetail, writeSummary } = {}) {
  if (typeof fetchCurrent !== 'function') throw new Error('fetchCurrent is required');
  if (typeof writeDetail !== 'function') throw new Error('writeDetail is required');
  if (typeof writeSummary !== 'function') throw new Error('writeSummary is required');

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
      console.log(JSON.stringify({
        event: 'receivables-staging-sync',
        contracts: summary.total.contracts,
        debt: summary.total.debt,
        managers: summary.byManager.length,
        branches: summary.byBranch.length
      }));
      return res.status(200).json({
        ok: true,
        mode: 'staging_only',
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
