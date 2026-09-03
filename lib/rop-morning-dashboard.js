function text(value) {
  return String(value ?? '').trim();
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/\u00A0/g, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function dateOnly(value) {
  const match = text(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
}

function previousDayInsideMonth(iso) {
  const current = dateOnly(iso);
  if (!current) throw new Error('asOfDate must be YYYY-MM-DD');
  const [year, month, day] = current.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  const previous = date.toISOString().slice(0, 10);
  return previous.slice(0, 7) === current.slice(0, 7) ? previous : current;
}

function statusFromRatio(ratio) {
  if (ratio >= 1) return 'ЗЕЛЁНЫЙ';
  if (ratio >= 0.95) return 'ЖЁЛТЫЙ';
  return 'КРАСНЫЙ';
}

function priorityFromStatus(status) {
  if (status === 'ЗЕЛЁНЫЙ') return 'ОК';
  if (status === 'ЖЁЛТЫЙ') return 'КОНТРОЛЬ';
  return 'СЕГОДНЯ';
}

function formatRub(value) {
  return `${Math.round(Math.max(0, toNumber(value))).toLocaleString('ru-RU')} ₽`;
}

function actionFor(status, deficit, level = 'МЕНЕДЖЕР') {
  if (status === 'ЗЕЛЁНЫЙ') {
    return level === 'ГОРОД'
      ? 'Удержать темп города; контролировать 100% оплаты и обещанные платежи.'
      : 'Удержать темп; контролировать 100% оплаты и обещанные платежи.';
  }
  if (status === 'ЖЁЛТЫЙ') {
    return `Добрать ${formatRub(deficit)} до темпа; проверить обещанные оплаты сегодня.`;
  }
  return `Добрать ${formatRub(deficit)} до плана на дату; старшей разобрать оплаты, дебиторку и ближайшие сделки сегодня.`;
}

function forecastFromPace(monthPlan, planToDate, factMtd) {
  const plan = toNumber(monthPlan);
  const elapsedPlan = toNumber(planToDate);
  const fact = toNumber(factMtd);
  if (!(plan > 0) || !(elapsedPlan > 0)) return roundMoney(fact);
  return roundMoney(fact / (elapsedPlan / plan));
}

function sourceContractMetrics(values, reportDate) {
  const headers = Array.isArray(values?.[0]) ? values[0] : [];
  const idx = new Map(headers.map((name, position) => [text(name), position]));
  if (!idx.has('StudentId') || !idx.has('Дата договора') || !idx.has('Долг')) return null;
  const unique = new Map();
  for (const row of Array.isArray(values) ? values.slice(1) : []) {
    const studentId = Number(row?.[idx.get('StudentId')]);
    const contractDate = dateOnly(row?.[idx.get('Дата договора')]);
    if (!Number.isInteger(studentId) || studentId <= 0 || !contractDate || contractDate > reportDate) continue;
    unique.set(studentId, row);
  }
  const rows = [...unique.values()];
  return {
    newContracts: rows.length,
    fullPaid: rows.filter(row => toNumber(row?.[idx.get('Долг')]) <= 0).length
  };
}

const HEADERS = [
  'Срез','Дата отчёта','Уровень','Менеджер','Филиал','План месяца','План к дате',
  'Факт дня','Факт с начала месяца','Выполнение','Дефицит к плану на дату',
  'Прогноз месяца','Отклонение прогноза','Контрольный план менеджера',
  'Личный факт дня','Личный факт с начала месяца','Новых договоров',
  '100% оплат новых договоров','Текущая ДЗ','Приоритет','Задача старшей','Примечание'
];

const REQUIRED_CONTROL_HEADERS = [
  'Дата','Менеджер','Филиал','План филиала на месяц','План филиала к дате',
  'Факт филиала за день','Факт филиала с начала месяца','Контрольный план менеджера на месяц',
  'Личный факт за день','Личный факт с начала месяца','Новых договоров с начала месяца',
  '100% оплаченных новых договоров','Текущая ДЗ филиала','Статус филиала','Примечание'
];

function headerIndex(values) {
  const headers = Array.isArray(values?.[0]) ? values[0] : [];
  const index = new Map(headers.map((name, position) => [text(name), position]));
  for (const required of REQUIRED_CONTROL_HEADERS) {
    if (!index.has(required)) throw new Error(`ROP control missing header: ${required}`);
  }
  return index;
}

function chooseClosedDate(rows, dateIndex, asOfDate) {
  const target = previousDayInsideMonth(asOfDate);
  const dates = [...new Set(rows.map(row => dateOnly(row?.[dateIndex])).filter(Boolean))].sort();
  const eligible = dates.filter(date => date <= target);
  if (eligible.length) return eligible[eligible.length - 1];
  const current = dateOnly(asOfDate);
  if (dates.includes(current)) return current;
  throw new Error('ROP control has no completed-day rows');
}

function managerRow(row, idx, reportDate, snapshot) {
  const monthPlan = roundMoney(toNumber(row[idx.get('План филиала на месяц')]));
  const planToDate = roundMoney(toNumber(row[idx.get('План филиала к дате')]));
  const dayFact = roundMoney(toNumber(row[idx.get('Факт филиала за день')]));
  const mtdFact = roundMoney(toNumber(row[idx.get('Факт филиала с начала месяца')]));
  const ratio = planToDate > 0 ? mtdFact / planToDate : (mtdFact > 0 ? 1 : 0);
  const deficit = roundMoney(Math.max(0, planToDate - mtdFact));
  const forecast = forecastFromPace(monthPlan, planToDate, mtdFact);
  const status = statusFromRatio(ratio);
  return [
    snapshot,
    reportDate,
    'МЕНЕДЖЕР',
    text(row[idx.get('Менеджер')]),
    text(row[idx.get('Филиал')]),
    monthPlan,
    planToDate,
    dayFact,
    mtdFact,
    ratio,
    deficit,
    forecast,
    roundMoney(forecast - monthPlan),
    roundMoney(toNumber(row[idx.get('Контрольный план менеджера на месяц')])),
    roundMoney(toNumber(row[idx.get('Личный факт за день')])),
    roundMoney(toNumber(row[idx.get('Личный факт с начала месяца')])),
    Math.round(toNumber(row[idx.get('Новых договоров с начала месяца')])),
    Math.round(toNumber(row[idx.get('100% оплаченных новых договоров')])),
    roundMoney(toNumber(row[idx.get('Текущая ДЗ филиала')])),
    priorityFromStatus(status),
    actionFor(status, deficit),
    text(row[idx.get('Примечание')])
  ];
}

function cityRow(selectedRows, idx, reportDate, snapshot, currentMonthContractsValues) {
  const uniqueBranches = new Map();
  for (const row of selectedRows) {
    const branch = text(row[idx.get('Филиал')]);
    if (branch && !uniqueBranches.has(branch)) uniqueBranches.set(branch, row);
  }
  const branches = [...uniqueBranches.values()];
  const sum = (rows, header) => roundMoney(rows.reduce((total, row) => total + toNumber(row[idx.get(header)]), 0));
  const monthPlan = sum(branches, 'План филиала на месяц');
  const planToDate = sum(branches, 'План филиала к дате');
  const dayFact = sum(branches, 'Факт филиала за день');
  const mtdFact = sum(branches, 'Факт филиала с начала месяца');
  const debt = sum(branches, 'Текущая ДЗ филиала');
  const ratio = planToDate > 0 ? mtdFact / planToDate : (mtdFact > 0 ? 1 : 0);
  const deficit = roundMoney(Math.max(0, planToDate - mtdFact));
  const forecast = roundMoney(branches.reduce((total, row) => total + forecastFromPace(
    row[idx.get('План филиала на месяц')],
    row[idx.get('План филиала к дате')],
    row[idx.get('Факт филиала с начала месяца')]
  ), 0));
  const sourceMetrics = sourceContractMetrics(currentMonthContractsValues, reportDate);
  const newContracts = sourceMetrics?.newContracts
    ?? Math.round(selectedRows.reduce((total, row) => total + toNumber(row[idx.get('Новых договоров с начала месяца')]), 0));
  const fullPaid = sourceMetrics?.fullPaid
    ?? Math.round(selectedRows.reduce((total, row) => total + toNumber(row[idx.get('100% оплаченных новых договоров')]), 0));
  const status = statusFromRatio(ratio);
  return [
    snapshot,
    reportDate,
    'ГОРОД',
    '',
    'Все филиалы',
    monthPlan,
    planToDate,
    dayFact,
    mtdFact,
    ratio,
    deficit,
    forecast,
    roundMoney(forecast - monthPlan),
    '',
    '',
    '',
    newContracts,
    fullPaid,
    debt,
    priorityFromStatus(status),
    actionFor(status, deficit, 'ГОРОД'),
    snapshot === 'СЕГОДНЯ — НА СЕЙЧАС'
      ? 'Текущий факт обновляется внутридневным sync; план к дате — целевой уровень к концу сегодняшнего дня.'
      : 'Прогноз линейный по фактическому темпу относительно уже прошедшей доли рабочего месяца.'
  ];
}

function snapshotRows(rows, idx, reportDate, snapshot, currentMonthContractsValues) {
  const selectedRows = rows.filter(row => dateOnly(row[idx.get('Дата')]) === reportDate);
  if (!selectedRows.length) return [];
  const managers = selectedRows
    .map(row => managerRow(row, idx, reportDate, snapshot))
    .sort((a, b) => {
      const rank = { 'СЕГОДНЯ': 0, 'КОНТРОЛЬ': 1, 'ОК': 2 };
      const priorityDiff = (rank[a[19]] ?? 9) - (rank[b[19]] ?? 9);
      return priorityDiff || String(a[4]).localeCompare(String(b[4]), 'ru') || String(a[3]).localeCompare(String(b[3]), 'ru');
    });
  return [cityRow(selectedRows, idx, reportDate, snapshot, currentMonthContractsValues), ...managers];
}

export function buildRopMorningDashboard({ controlValues, currentMonthContractsValues, asOfDate } = {}) {
  const idx = headerIndex(controlValues);
  const rows = (Array.isArray(controlValues) ? controlValues.slice(1) : [])
    .filter(row => Array.isArray(row) && text(row[idx.get('Менеджер')]));
  if (!rows.length) throw new Error('ROP control is empty');

  const currentDate = dateOnly(asOfDate);
  if (!currentDate) throw new Error('asOfDate must be YYYY-MM-DD');
  const reportDate = chooseClosedDate(rows, idx.get('Дата'), currentDate);
  const closedRows = snapshotRows(rows, idx, reportDate, 'ВЧЕРА — ЗАКРЫТО', currentMonthContractsValues);
  const hasLive = rows.some(row => dateOnly(row[idx.get('Дата')]) === currentDate);
  const liveRows = hasLive ? snapshotRows(rows, idx, currentDate, 'СЕГОДНЯ — НА СЕЙЧАС', currentMonthContractsValues) : [];
  const liveDate = liveRows.length ? currentDate : '';
  const priorityRows = liveRows.length ? liveRows : closedRows;
  const managerPriorityRows = priorityRows.filter(row => row[2] === 'МЕНЕДЖЕР');
  const branchSet = new Set(managerPriorityRows.map(row => text(row[4])).filter(Boolean));

  return {
    reportDate,
    liveDate,
    values: [HEADERS, ...closedRows, ...liveRows],
    metrics: {
      managers: managerPriorityRows.length,
      branches: branchSet.size,
      todayPriority: managerPriorityRows.filter(row => row[19] === 'СЕГОДНЯ').length,
      live: Boolean(liveRows.length)
    }
  };
}
