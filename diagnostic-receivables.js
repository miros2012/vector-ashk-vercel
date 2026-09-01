import { createAshkReceivablesSource } from './lib/ashk-receivables-source.js';
import { buildReceivableRows, buildReceivableSummary } from './lib/ashk-receivables.js';

const source = createAshkReceivablesSource({
  baseUrl: 'https://app.dscontrol.ru',
  apiKey: process.env.ASHK_API_KEY || '',
  concurrency: 6,
  timeoutMs: 8000
});

const { groups, contractsByGroup } = await source.fetchCurrent();
const rows = buildReceivableRows(groups, contractsByGroup);
const summary = buildReceivableSummary(rows);
const nonEmptyGroups = [...contractsByGroup.values()].filter(items => Array.isArray(items) && items.length > 0).length;

console.log('ASHK_RECEIVABLES_LIVE_AGGREGATE_OK', JSON.stringify({
  groups: groups.length,
  queriedGroups: contractsByGroup.size,
  nonEmptyGroups,
  debtorContracts: summary.total.contracts,
  debtTotal: summary.total.debt,
  salesSumOfDebtors: summary.total.salesSum,
  debitSumOfDebtors: summary.total.debitSum,
  managerCount: summary.byManager.length,
  branchCount: summary.byBranch.length
}));
