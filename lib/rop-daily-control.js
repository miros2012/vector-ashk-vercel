function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? '').replace(/\u00A0/g, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function text(value) {
  return String(value ?? '').trim();
}

function dateOnly(value) {
  const match = text(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
}

export function receivablesValuesToStudents(values) {
  const headers = Array.isArray(values?.[0]) ? values[0] : [];
  const idx = new Map(headers.map((name, position) => [text(name), position]));
  const required = ['StudentId','GroupId','Филиал','Менеджер','Договор','Дата договора','Статус','Продажи','Оплачено','Долг'];
  for (const header of required) {
    if (!idx.has(header)) throw new Error(`Receivables detail missing header: ${header}`);
  }
  return (Array.isArray(values) ? values.slice(1) : [])
    .filter(row => Array.isArray(row) && Number(row[idx.get('StudentId')]) > 0)
    .map(row => ({
      Id: Number(row[idx.get('StudentId')]),
      StudyGroupId: Number(row[idx.get('GroupId')]) || 0,
      TrainingRoomName: text(row[idx.get('Филиал')]),
      OwnerName: text(row[idx.get('Менеджер')]),
      ContractDate: dateOnly(row[idx.get('Дата договора')]),
      SalesSum: roundMoney(toNumber(row[idx.get('Продажи')])),
      DebitSum: roundMoney(toNumber(row[idx.get('Оплачено')])),
      Debt: roundMoney(toNumber(row[idx.get('Долг')])),
      State: text(row[idx.get('Статус')]),
      ContractName: text(row[idx.get('Договор')])
    }));
}

function daysInMonth(month) {
  const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error('month must be YYYY-MM');
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new Error('month must be YYYY-MM');
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function isoDate(month, day) {
  return `${month}-${String(day).padStart(2, '0')}`;
}

function dayWeight(schedule, iso) {
  const date = new Date(`${iso}T12:00:00Z`);
  const weekday = date.getUTCDay(); // 0 Sun .. 6 Sat
  if (schedule === '5/2' && (weekday === 0 || weekday === 6)) return 0;
  if (weekday === 2 || weekday === 4) return 0.7;
  return 1;
}

function pacing(schedule, month, throughDate) {
  const count = daysInMonth(month);
  let total = 0;
  let elapsed = 0;
  for (let day = 1; day <= count; day += 1) {
    const iso = isoDate(month, day);
    const weight = dayWeight(schedule, iso);
    total += weight;
    if (iso <= throughDate) elapsed += weight;
  }
  return total > 0 ? elapsed / total : 0;
}

function statusFromRatio(ratio) {
  if (ratio >= 1) return 'ЗЕЛЁНЫЙ';
  if (ratio >= 0.95) return 'ЖЁЛТЫЙ';
  return 'КРАСНЫЙ';
}

function parsePlans(values) {
  const rows = Array.isArray(values) ? values.slice(1) : [];
  const plans = rows
    .filter(row => text(row?.[0]))
    .filter(row => !/^нет$/i.test(text(row?.[6])))
    .map(row => ({
      manager: text(row[0]),
      branch: text(row[1]),
      ashkBranch: text(row[2]),
      branchPlan: roundMoney(toNumber(row[3])),
      managerPlan: roundMoney(toNumber(row[4])),
      schedule: text(row[5]) || '5/2',
      note: text(row[7])
    }));
  if (!plans.length) throw new Error('ROP plan is empty');
  return plans;
}

function flattenContracts(groups, contractsByGroup, plans) {
  const branchByGroup = new Map(
    (Array.isArray(groups) ? groups : [])
      .map(group => [Number(group?.Id), text(group?.TrainingRoomName)])
      .filter(([id]) => Number.isFinite(id))
  );
  const planBranchByAshk = new Map(plans.map(plan => [plan.ashkBranch, plan.branch]));
  const entries = contractsByGroup instanceof Map
    ? contractsByGroup.entries()
    : Object.entries(contractsByGroup || {}).map(([key, value]) => [Number(key), value]);
  const rows = [];
  for (const [groupIdRaw, contracts] of entries) {
    const groupId = Number(groupIdRaw);
    const ashkBranch = branchByGroup.get(groupId) || '';
    const branch = planBranchByAshk.get(ashkBranch) || '';
    for (const contract of Array.isArray(contracts) ? contracts : []) {
      const studentId = Number(contract?.Id);
      if (!Number.isFinite(studentId)) continue;
      rows.push({
        studentId,
        groupId: Number(contract?.StudyGroupId ?? groupId),
        ashkBranch,
        branch,
        manager: text(contract?.OwnerName),
        contractDate: dateOnly(contract?.ContractDate),
        salesSum: roundMoney(toNumber(contract?.SalesSum)),
        debitSum: roundMoney(toNumber(contract?.DebitSum)),
        debt: roundMoney(toNumber(contract?.Debt)),
        state: text(contract?.State),
        contractName: text(contract?.ContractName)
      });
    }
  }
  return rows;
}

function flattenFallbackStudents(fallbackStudents, plans) {
  const planBranchByAshk = new Map(plans.map(plan => [plan.ashkBranch, plan.branch]));
  const rows = [];
  for (const contract of Array.isArray(fallbackStudents) ? fallbackStudents : []) {
    const studentId = Number(contract?.Id);
    if (!Number.isFinite(studentId)) continue;
    const ashkBranch = text(contract?.TrainingRoomName);
    rows.push({
      studentId,
      groupId: Number(contract?.StudyGroupId),
      ashkBranch,
      branch: planBranchByAshk.get(ashkBranch) || '',
      manager: text(contract?.OwnerName),
      contractDate: dateOnly(contract?.ContractDate),
      salesSum: roundMoney(toNumber(contract?.SalesSum)),
      debitSum: roundMoney(toNumber(contract?.DebitSum)),
      debt: roundMoney(toNumber(contract?.Debt)),
      state: text(contract?.State),
      contractName: text(contract?.ContractName)
    });
  }
  return rows;
}

function paymentRows(values) {
  return (Array.isArray(values) ? values : [])
    .slice(1)
    .filter(row => Array.isArray(row) && text(row[0]))
    .map(row => ({
      id: text(row[0]),
      date: dateOnly(row[1]),
      studentId: Number(row[2]),
      amount: roundMoney(toNumber(row[7]))
    }));
}

function sumByDate(items, key) {
  const map = new Map();
  for (const item of items) {
    const value = text(item?.[key]);
    if (!value || !item.date) continue;
    const compound = `${item.date}\u0000${value}`;
    map.set(compound, roundMoney((map.get(compound) || 0) + toNumber(item.amount)));
  }
  return map;
}

function cumulative(map, value, date) {
  let total = 0;
  const suffix = `\u0000${value}`;
  for (const [compound, amount] of map.entries()) {
    const split = compound.indexOf('\u0000');
    const itemDate = compound.slice(0, split);
    if (compound.endsWith(suffix) && itemDate <= date) total += toNumber(amount);
  }
  return roundMoney(total);
}

function countContracts(contracts, { branch, manager, date, fullPaid, singleManager }) {
  return contracts.filter(contract => {
    if (contract.branch !== branch || !contract.contractDate || contract.contractDate > date) return false;
    if (!singleManager && contract.manager !== manager) return false;
    if (fullPaid && contract.debt > 0) return false;
    return true;
  }).length;
}

const CONTRACT_HEADERS = [
  'StudentId','Дата договора','Филиал','Филиал АШК','Менеджер АШК','Продажи','Оплачено','Долг','Статус','Договор'
];

const CONTROL_HEADERS = [
  'Дата','Менеджер','Филиал','План филиала на месяц','План филиала к дате',
  'Факт филиала за день','Факт филиала с начала месяца','Выполнение плана филиала',
  'Контрольный план менеджера на месяц','Контрольный план менеджера к дате',
  'Личный факт за день','Личный факт с начала месяца','Выполнение личного темпа',
  'Новых договоров с начала месяца','100% оплаченных новых договоров','Текущая ДЗ филиала',
  'Статус филиала','Статус личный','Примечание'
];

const UNMATCHED_PAYMENT_HEADERS = [
  'ID оплаты','Дата','StudentId','Сумма','Причина','Филиал АШК','Менеджер АШК'
];

export function buildRopDailyControlWorkbook({
  planValues,
  groups,
  contractsByGroup,
  fallbackStudents,
  paymentValues,
  month,
  asOfDate
} = {}) {
  const plans = parsePlans(planValues);
  const endDate = dateOnly(asOfDate);
  if (!endDate || !endDate.startsWith(`${month}-`)) throw new Error('asOfDate must be inside month');

  const liveContracts = flattenContracts(groups, contractsByGroup, plans);
  const liveStudentIds = new Set(liveContracts.map(contract => contract.studentId));
  const fallbackByStudent = new Map();
  for (const contract of flattenFallbackStudents(fallbackStudents, plans)) {
    fallbackByStudent.set(contract.studentId, contract);
  }
  const fallbackContracts = [...fallbackByStudent.values()]
    .filter(contract => !liveStudentIds.has(contract.studentId));
  const contracts = [...liveContracts, ...fallbackContracts];
  const currentMonthContracts = contracts
    .filter(contract => contract.contractDate?.startsWith(`${month}-`))
    .sort((a, b) => a.contractDate.localeCompare(b.contractDate) || a.studentId - b.studentId);
  const studentLookup = new Map();
  for (const contract of fallbackContracts) studentLookup.set(contract.studentId, contract);
  for (const contract of liveContracts) studentLookup.set(contract.studentId, contract);

  const managersByBranch = new Map();
  for (const plan of plans) {
    const list = managersByBranch.get(plan.branch) || [];
    list.push(plan.manager);
    managersByBranch.set(plan.branch, list);
  }

  const debtByBranch = new Map();
  for (const contract of contracts) {
    if (!contract.branch || !(contract.debt > 0)) continue;
    debtByBranch.set(contract.branch, roundMoney((debtByBranch.get(contract.branch) || 0) + contract.debt));
  }

  const resolvedPayments = [];
  const unmatchedPaymentRows = [];
  let unmatchedPayments = 0;
  let unmatchedPaymentAmount = 0;
  for (const payment of paymentRows(paymentValues)) {
    if (!payment.date.startsWith(`${month}-`) || payment.date > endDate) continue;
    const contract = studentLookup.get(payment.studentId);
    if (!contract) {
      unmatchedPayments += 1;
      unmatchedPaymentAmount += payment.amount;
      unmatchedPaymentRows.push([
        payment.id,
        payment.date,
        payment.studentId,
        payment.amount,
        'STUDENT_NOT_IN_CURRENT_SNAPSHOT',
        '',
        ''
      ]);
      continue;
    }
    if (!contract.branch) {
      unmatchedPayments += 1;
      unmatchedPaymentAmount += payment.amount;
      unmatchedPaymentRows.push([
        payment.id,
        payment.date,
        payment.studentId,
        payment.amount,
        'BRANCH_NOT_MAPPED',
        contract.ashkBranch,
        contract.manager
      ]);
      continue;
    }
    const activeManagers = managersByBranch.get(contract.branch) || [];
    let creditedManager = '';
    if (activeManagers.length === 1) creditedManager = activeManagers[0];
    else if (activeManagers.includes(contract.manager)) creditedManager = contract.manager;
    resolvedPayments.push({
      ...payment,
      branch: contract.branch,
      manager: creditedManager
    });
  }

  const branchDaily = sumByDate(resolvedPayments, 'branch');
  const managerDaily = sumByDate(resolvedPayments.filter(item => item.manager), 'manager');
  const controlRows = [];
  const maxDay = Number(endDate.slice(-2));
  for (let day = 1; day <= maxDay; day += 1) {
    const date = isoDate(month, day);
    for (const plan of plans) {
      const pace = pacing(plan.schedule, month, date);
      const branchPlanToDate = roundMoney(plan.branchPlan * pace);
      const managerPlanToDate = roundMoney(plan.managerPlan * pace);
      const branchDay = branchDaily.get(`${date}\u0000${plan.branch}`) || 0;
      const branchMtd = cumulative(branchDaily, plan.branch, date);
      const managerDay = managerDaily.get(`${date}\u0000${plan.manager}`) || 0;
      const managerMtd = cumulative(managerDaily, plan.manager, date);
      const branchRatio = branchPlanToDate > 0 ? branchMtd / branchPlanToDate : (branchMtd > 0 ? 1 : 0);
      const managerRatio = managerPlanToDate > 0 ? managerMtd / managerPlanToDate : (managerMtd > 0 ? 1 : 0);
      const activeManagers = managersByBranch.get(plan.branch) || [];
      const singleManager = activeManagers.length === 1;
      const noteParts = [];
      if (!singleManager) noteParts.push('Общий филиальный план; личный факт показывает только оплаты, однозначно привязанные к действующему менеджеру АШК.');
      if (plan.note) noteParts.push(plan.note);
      controlRows.push([
        date,
        plan.manager,
        plan.branch,
        plan.branchPlan,
        branchPlanToDate,
        branchDay,
        branchMtd,
        branchPlanToDate > 0 ? branchRatio : '',
        plan.managerPlan,
        managerPlanToDate,
        managerDay,
        managerMtd,
        managerPlanToDate > 0 ? managerRatio : '',
        countContracts(currentMonthContracts, { branch: plan.branch, manager: plan.manager, date, fullPaid: false, singleManager }),
        countContracts(currentMonthContracts, { branch: plan.branch, manager: plan.manager, date, fullPaid: true, singleManager }),
        debtByBranch.get(plan.branch) || 0,
        statusFromRatio(branchRatio),
        singleManager ? statusFromRatio(managerRatio) : 'ИНФО',
        noteParts.join(' ')
      ]);
    }
  }

  return {
    currentMonthContractsValues: [
      CONTRACT_HEADERS,
      ...currentMonthContracts.map(contract => [
        contract.studentId,
        contract.contractDate,
        contract.branch,
        contract.ashkBranch,
        contract.manager,
        contract.salesSum,
        contract.debitSum,
        contract.debt,
        contract.state,
        contract.contractName
      ])
    ],
    controlValues: [CONTROL_HEADERS, ...controlRows],
    unmatchedPaymentValues: [UNMATCHED_PAYMENT_HEADERS, ...unmatchedPaymentRows],
    metrics: {
      currentMonthContracts: currentMonthContracts.length,
      resolvedPayments: resolvedPayments.length,
      unmatchedPayments,
      unmatchedPaymentAmount: roundMoney(unmatchedPaymentAmount),
      fallbackStudentsUsed: fallbackContracts.length
    }
  };
}
