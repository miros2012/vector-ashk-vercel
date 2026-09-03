import { google } from 'googleapis';
import syncHours from './sync-hours.js';
import syncPayments from './sync-payments.js';
import reconcileDecisions from './decision-reconcile-daily.js';
import { publishRopNow } from './health.js';
import { createNightlyFinanceOrchestrator } from '../lib/nightly-finance-orchestrator.js';
import { createIntradayRopOrchestrator } from '../lib/rop-intraday-orchestrator.js';
import { syncRopSourceThenPublishTarget } from '../lib/rop-publisher.js';
import { createAshkReceivablesSource } from '../lib/ashk-receivables-source.js';
import { createReceivablesSyncHandler } from '../lib/receivables-sync-handler.js';
import { buildRopDailyControlWorkbook, receivablesValuesToStudents } from '../lib/rop-daily-control.js';
import { buildRopMorningDashboard } from '../lib/rop-morning-dashboard.js';
import { buildRopDebtorPriority, buildRopTasksToday } from '../lib/rop-tasks-today.js';

const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const RECEIVABLES_DETAIL_SHEET = 'АШК_Дебиторка__vercel';
const RECEIVABLES_SUMMARY_SHEET = 'АШК_Дебиторка_Свод__vercel';
const PAYMENTS_STAGING_SHEET = 'АШК_Оплаты__vercel';
const ROP_PLAN_SHEET = 'РОП_План_Сентябрь';
const ROP_CONTROL_SHEET = 'РОП_Контроль_Дня';
const ROP_MORNING_SHEET = 'РОП_Штаб_Утро';
const ROP_TASKS_SHEET = 'РОП_Задачи_Сегодня';
const ROP_DEBTOR_PRIORITY_SHEET = 'РОП_Дебиторка_Приоритет';
const ROP_UNMATCHED_SHEET = 'РОП_Неопознанные_Оплаты__diag';
const ROP_PAYMENT_ATTRIBUTION_SHEET = 'РОП_Привязка_Оплат__diag';
const CURRENT_MONTH_CONTRACTS_SHEET = 'АШК_Контракты_ТекущийМесяц__vercel';
const BUSINESS_TZ = 'Asia/Yekaterinburg';
const INTRADAY_SCHEDULES = new Set(Array.from({ length: 12 }, (_, index) => `0 ${index + 4} * * *`));

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function tyumenToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const part = type => parts.find(item => item.type === type)?.value || '';
  const year = part('year');
  const monthNumber = part('month');
  const day = part('day');
  if (!year || !monthNumber || !day) throw new Error('Tyumen business date unavailable');
  return {
    date: `${year}-${monthNumber}-${day}`,
    month: `${year}-${monthNumber}`
  };
}

let sheetsPromise;
async function getSheets() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account secrets missing');
  }
  if (!sheetsPromise) {
    sheetsPromise = (async () => {
      const auth = new google.auth.JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: privateKey(),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      await auth.authorize();
      return google.sheets({ version: 'v4', auth });
    })();
  }
  return sheetsPromise;
}

async function ensureSheet(sheets, title, rowCount, columnCount) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'
  });
  const existing = (metadata.data.sheets || []).find(sheet => sheet.properties?.title === title);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title, gridProperties: { rowCount, columnCount } } } }]
      }
    });
    return;
  }
  const currentRows = Number(existing.properties?.gridProperties?.rowCount || 0);
  const currentColumns = Number(existing.properties?.gridProperties?.columnCount || 0);
  if (currentRows < rowCount || currentColumns < columnCount) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: {
              sheetId: existing.properties.sheetId,
              gridProperties: {
                rowCount: Math.max(currentRows, rowCount),
                columnCount: Math.max(currentColumns, columnCount)
              }
            },
            fields: 'gridProperties(rowCount,columnCount)'
          }
        }]
      }
    });
  }
}

async function writeValues(sheetName, range, values, columns) {
  const sheets = await getSheets();
  await ensureSheet(sheets, sheetName, Math.max(values.length + 20, 500), columns);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!${range}`
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values }
  });
}

async function readValues(sheetName, range) {
  const sheets = await getSheets();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!${range}`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  return result.data.values || [];
}

function persistedContractsToStudents(values) {
  return (Array.isArray(values) ? values.slice(1) : [])
    .filter(row => Array.isArray(row) && Number(row?.[0]) > 0)
    .map(row => ({
      Id: Number(row[0]),
      ContractDate: row[1] ?? '',
      TrainingRoomName: row[3] ?? '',
      OwnerName: row[4] ?? '',
      SalesSum: row[5] ?? 0,
      DebitSum: row[6] ?? 0,
      Debt: row[7] ?? 0,
      State: row[8] ?? '',
      ContractName: row[9] ?? ''
    }));
}

function missingStudentIds(workbook) {
  return [...new Set(
    workbook.unmatchedPaymentValues
      .slice(1)
      .filter(row => String(row?.[4] || '') === 'STUDENT_NOT_IN_CURRENT_SNAPSHOT')
      .map(row => Number(row?.[2]))
      .filter(studentId => Number.isInteger(studentId) && studentId > 0)
  )];
}

async function fetchFallbackStudents(studentIds) {
  let failures = 0;
  const details = await Promise.all(studentIds.map(async studentId => {
    try {
      const student = await receivablesSource.fetchStudent(studentId);
      if (Number(student?.Id) !== studentId) {
        failures += 1;
        return null;
      }
      return student;
    } catch {
      failures += 1;
      return null;
    }
  }));
  return { students: details.filter(Boolean), failures };
}

async function persistRopOutputs({
  workbook,
  planValues,
  receivablesValues,
  date,
  month,
  writeContracts = true,
  fallbackRequested = 0,
  fallbackResolved = 0,
  fallbackLookupFailures = 0
}) {
  const morningDashboard = buildRopMorningDashboard({
    controlValues: workbook.controlValues,
    currentMonthContractsValues: workbook.currentMonthContractsValues,
    asOfDate: date
  });
  const tasksToday = buildRopTasksToday({
    morningValues: morningDashboard.values,
    taskDate: date
  });
  const debtorPriority = buildRopDebtorPriority({
    receivablesValues,
    taskValues: tasksToday.values,
    planValues,
    limitPerBranch: 5
  });

  if (writeContracts) {
    await writeValues(CURRENT_MONTH_CONTRACTS_SHEET, 'A:J', workbook.currentMonthContractsValues, 10);
  }
  await writeValues(ROP_CONTROL_SHEET, 'A:S', workbook.controlValues, 19);
  await writeValues(ROP_MORNING_SHEET, 'A:X', morningDashboard.values, 24);
  await writeValues(ROP_TASKS_SHEET, 'A:P', tasksToday.values, 16);
  await writeValues(ROP_DEBTOR_PRIORITY_SHEET, 'A:N', debtorPriority.values, 14);
  await writeValues(ROP_UNMATCHED_SHEET, 'A:G', workbook.unmatchedPaymentValues, 7);
  await writeValues(ROP_PAYMENT_ATTRIBUTION_SHEET, 'A:J', workbook.paymentAttributionValues, 10);

  const reads = await Promise.all([
    writeContracts ? readValues(CURRENT_MONTH_CONTRACTS_SHEET, 'A:J') : Promise.resolve(null),
    readValues(ROP_CONTROL_SHEET, 'A:S'),
    readValues(ROP_MORNING_SHEET, 'A:X'),
    readValues(ROP_TASKS_SHEET, 'A:P'),
    readValues(ROP_DEBTOR_PRIORITY_SHEET, 'A:N'),
    readValues(ROP_UNMATCHED_SHEET, 'A:G'),
    readValues(ROP_PAYMENT_ATTRIBUTION_SHEET, 'A:J')
  ]);
  const [
    contractsReadback,
    controlReadback,
    morningReadback,
    tasksReadback,
    debtorPriorityReadback,
    unmatchedReadback,
    paymentAttributionReadback
  ] = reads;
  const contractsVerified = !writeContracts || (
    contractsReadback.length === workbook.currentMonthContractsValues.length
    && String(contractsReadback?.[0]?.[0] || '') === 'StudentId'
  );
  const controlVerified = controlReadback.length === workbook.controlValues.length
    && String(controlReadback?.[0]?.[0] || '') === 'Дата';
  const morningVerified = morningReadback.length === morningDashboard.values.length
    && String(morningReadback?.[0]?.[0] || '') === 'Срез';
  const tasksVerified = tasksReadback.length === tasksToday.values.length
    && String(tasksReadback?.[0]?.[0] || '') === 'Дата задачи';
  const debtorPriorityVerified = debtorPriorityReadback.length === debtorPriority.values.length
    && String(debtorPriorityReadback?.[0]?.[5] || '') === 'StudentId';
  const unmatchedVerified = unmatchedReadback.length === workbook.unmatchedPaymentValues.length
    && String(unmatchedReadback?.[0]?.[0] || '') === 'ID оплаты';
  const paymentAttributionVerified = paymentAttributionReadback.length === workbook.paymentAttributionValues.length
    && String(paymentAttributionReadback?.[0]?.[9] || '') === 'Статус привязки';
  if (!contractsVerified || !controlVerified || !morningVerified || !tasksVerified
    || !debtorPriorityVerified || !unmatchedVerified || !paymentAttributionVerified) {
    throw new Error('ROP daily control readback verification failed');
  }

  const result = {
    ok: true,
    month,
    asOfDate: date,
    liveDate: morningDashboard.liveDate,
    controlRows: workbook.controlValues.length - 1,
    morningReportDate: morningDashboard.reportDate,
    morningPriorityCount: morningDashboard.metrics.todayPriority,
    tasksTodayCount: tasksToday.metrics.tasks,
    tasksTodayDeficit: tasksToday.metrics.totalDeficit,
    debtorPriorityRows: debtorPriority.metrics.rows,
    debtorPriorityDebt: debtorPriority.metrics.prioritizedDebt,
    currentMonthContracts: workbook.metrics.currentMonthContracts,
    fallbackRequested,
    fallbackResolved,
    fallbackLookupFailures,
    unmatchedPayments: workbook.metrics.unmatchedPayments,
    unmatchedPaymentAmount: workbook.metrics.unmatchedPaymentAmount,
    managerAttributedPayments: workbook.metrics.managerAttributedPayments,
    managerUnattributedPayments: workbook.metrics.managerUnattributedPayments,
    managerUnattributedAmount: workbook.metrics.managerUnattributedAmount,
    verified: true
  };
  console.log(JSON.stringify({ event: 'rop-daily-control-sync', ...result }));
  return result;
}

async function syncRopDailyControl({ groups, contractsByGroup }) {
  const { date, month } = tyumenToday();
  const [planValues, paymentValues, receivablesValues] = await Promise.all([
    readValues(ROP_PLAN_SHEET, 'A:H'),
    readValues(PAYMENTS_STAGING_SHEET, 'A:H'),
    readValues(RECEIVABLES_DETAIL_SHEET, 'A:M')
  ]);
  let fallbackStudents = receivablesValuesToStudents(receivablesValues);

  let workbook = buildRopDailyControlWorkbook({
    planValues,
    groups,
    contractsByGroup,
    fallbackStudents,
    paymentValues,
    month,
    asOfDate: date
  });
  const ids = missingStudentIds(workbook);
  let fallbackLookupFailures = 0;
  let resolved = [];
  if (ids.length) {
    const fallback = await fetchFallbackStudents(ids);
    resolved = fallback.students;
    fallbackStudents = [...fallbackStudents, ...resolved];
    fallbackLookupFailures = fallback.failures;
    if (resolved.length) {
      workbook = buildRopDailyControlWorkbook({
        planValues,
        groups,
        contractsByGroup,
        fallbackStudents,
        paymentValues,
        month,
        asOfDate: date
      });
    }
  }

  return persistRopOutputs({
    workbook,
    planValues,
    receivablesValues,
    date,
    month,
    writeContracts: true,
    fallbackRequested: ids.length,
    fallbackResolved: resolved.length,
    fallbackLookupFailures
  });
}

async function refreshRopFromStaging() {
  const { date, month } = tyumenToday();
  const [planValues, paymentValues, currentContractsValues, receivablesValues] = await Promise.all([
    readValues(ROP_PLAN_SHEET, 'A:H'),
    readValues(PAYMENTS_STAGING_SHEET, 'A:H'),
    readValues(CURRENT_MONTH_CONTRACTS_SHEET, 'A:J'),
    readValues(RECEIVABLES_DETAIL_SHEET, 'A:M')
  ]);
  const baseStudents = persistedContractsToStudents(currentContractsValues);
  if (!baseStudents.length) throw new Error('Current-month ROP contract staging is empty');

  let fallbackStudents = [...receivablesValuesToStudents(receivablesValues), ...baseStudents];
  let workbook = buildRopDailyControlWorkbook({
    planValues,
    groups: [],
    contractsByGroup: {},
    fallbackStudents,
    paymentValues,
    month,
    asOfDate: date
  });
  const ids = missingStudentIds(workbook);
  let fallbackLookupFailures = 0;
  let resolved = [];
  if (ids.length) {
    const fallback = await fetchFallbackStudents(ids);
    resolved = fallback.students;
    fallbackLookupFailures = fallback.failures;
    if (resolved.length) {
      fallbackStudents = [...fallbackStudents, ...resolved];
      workbook = buildRopDailyControlWorkbook({
        planValues,
        groups: [],
        contractsByGroup: {},
        fallbackStudents,
        paymentValues,
        month,
        asOfDate: date
      });
    }
  }

  return persistRopOutputs({
    workbook,
    planValues,
    receivablesValues,
    date,
    month,
    writeContracts: false,
    fallbackRequested: ids.length,
    fallbackResolved: resolved.length,
    fallbackLookupFailures
  });
}

async function syncRopDailyControlAndPublish(payload) {
  return syncRopSourceThenPublishTarget({
    refreshSource: () => syncRopDailyControl(payload),
    publishTarget: publishRopNow
  });
}

async function refreshRopFromStagingAndPublish() {
  return syncRopSourceThenPublishTarget({
    refreshSource: refreshRopFromStaging,
    publishTarget: publishRopNow
  });
}

const receivablesSource = createAshkReceivablesSource({
  baseUrl: 'https://app.dscontrol.ru',
  apiKey: process.env.ASHK_API_KEY || '',
  concurrency: 6,
  timeoutMs: 8000
});

const syncReceivables = createReceivablesSyncHandler({
  fetchCurrent: receivablesSource.fetchCurrent,
  writeDetail: values => writeValues(RECEIVABLES_DETAIL_SHEET, 'A:M', values, 13),
  writeSummary: values => writeValues(RECEIVABLES_SUMMARY_SHEET, 'A:F', values, 6),
  readDetail: () => readValues(RECEIVABLES_DETAIL_SHEET, 'A:M'),
  readSummary: () => readValues(RECEIVABLES_SUMMARY_SHEET, 'A:F'),
  afterVerified: syncRopDailyControlAndPublish
});

export const runReceivablesNow = syncReceivables;
export const runIntradayRopNow = refreshRopFromStagingAndPublish;

const nightlyHandler = createNightlyFinanceOrchestrator({
  cronSecret: process.env.CRON_SECRET || '',
  runHours: syncHours,
  runPayments: syncPayments,
  runReceivables: syncReceivables,
  runDecisions: reconcileDecisions
});

const intradayHandler = createIntradayRopOrchestrator({
  cronSecret: process.env.CRON_SECRET || '',
  runPayments: syncPayments,
  refreshRop: refreshRopFromStagingAndPublish
});

export default async function handler(req, res) {
  const schedule = String(req?.headers?.['x-vercel-cron-schedule'] || '');
  if (INTRADAY_SCHEDULES.has(schedule)) {
    return intradayHandler(req, res);
  }
  return nightlyHandler(req, res);
}
