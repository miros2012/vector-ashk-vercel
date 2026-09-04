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

const HEADERS = [
  'Дата задачи','Дата отчёта','Приоритет','Филиал','Ответственные','План месяца',
  'План к дате','Факт сегодня','Факт с начала месяца','Дефицит, ₽','Прогноз месяца',
  'Текущая ДЗ','Задача','Срок','Статус исполнения','Примечание',
  'План сбора ДЗ, ₽','Доля ДЗ к сбору','Финансовая цель'
];

const REQUIRED = [
  'Дата отчёта','Уровень','Менеджер','Филиал','План месяца','План к дате',
  'Факт с начала месяца','Дефицит к плану на дату','Прогноз месяца',
  'Текущая ДЗ','Приоритет','Задача старшей','Примечание'
];

function indexHeaders(values) {
  const headers = Array.isArray(values?.[0]) ? values[0] : [];
  const idx = new Map(headers.map((name, position) => [text(name), position]));
  const aliases = new Map([
    ['План месяца', 'План филиала на месяц'],
    ['План к дате', 'План филиала к дате'],
    ['Факт дня', 'Факт филиала за день'],
    ['Факт с начала месяца', 'Факт филиала с начала месяца'],
    ['Дефицит к плану на дату', 'Дефицит филиала к плану на дату'],
    ['Прогноз месяца', 'Прогноз филиала на месяц']
  ]);
  for (const [legacy, current] of aliases) {
    if (!idx.has(legacy) && idx.has(current)) idx.set(legacy, idx.get(current));
  }
  for (const required of REQUIRED) {
    if (!idx.has(required)) throw new Error(`ROP morning dashboard missing header: ${required}`);
  }
  if (!idx.has('Факт дня') && !idx.has('Факт вчера')) {
    throw new Error('ROP morning dashboard missing header: Факт дня');
  }
  return idx;
}

function factHeader(idx) {
  return idx.has('Факт дня') ? 'Факт дня' : 'Факт вчера';
}

function sameMoney(a, b) {
  return Math.abs(toNumber(a) - toNumber(b)) <= 0.01;
}

function assertConsistent(existing, row, idx) {
  const fields = [
    'План месяца','План к дате',factHeader(idx),'Факт с начала месяца',
    'Дефицит к плану на дату','Прогноз месяца','Текущая ДЗ'
  ];
  for (const field of fields) {
    if (!sameMoney(existing[idx.get(field)], row[idx.get(field)])) {
      throw new Error(`ROP branch rows disagree for ${text(row[idx.get('Филиал')])}: ${field}`);
    }
  }
  if (dateOnly(existing[idx.get('Дата отчёта')]) !== dateOnly(row[idx.get('Дата отчёта')])) {
    throw new Error(`ROP branch rows disagree for ${text(row[idx.get('Филиал')])}: report date`);
  }
}

function rank(priority) {
  if (priority === 'СЕГОДНЯ') return 0;
  if (priority === 'КОНТРОЛЬ') return 1;
  return 9;
}

function executionStatus(priority) {
  return priority === 'СЕГОДНЯ' ? 'К РАБОТЕ' : 'КОНТРОЛЬ';
}

function chooseSourceRows(morningValues, idx, task) {
  const all = (Array.isArray(morningValues) ? morningValues.slice(1) : [])
    .filter(row => Array.isArray(row))
    .filter(row => text(row[idx.get('Уровень')]) === 'МЕНЕДЖЕР');
  if (!idx.has('Срез')) return all;

  const live = all.filter(row => text(row[idx.get('Срез')]) === 'СЕГОДНЯ — НА СЕЙЧАС' && dateOnly(row[idx.get('Дата отчёта')]) === task);
  if (live.length) return live;
  const closed = all.filter(row => text(row[idx.get('Срез')]) === 'ВЧЕРА — ЗАКРЫТО');
  return closed.length ? closed : all;
}

function allocateCollectionTarget(output, financeCollectionTarget, financeCashGap) {
  const totalDebt = output.reduce((sum, row) => sum + Math.max(0, toNumber(row[11])), 0);
  const requested = Math.max(0, Math.round(toNumber(financeCollectionTarget)));
  const target = Math.min(requested, Math.round(totalDebt));
  const cashGap = Math.max(0, Math.round(toNumber(financeCashGap)));
  if (!(target > 0) || !(totalDebt > 0)) {
    for (const row of output) row.push(0, 0, '');
    return 0;
  }

  const ratio = target / totalDebt;
  let allocated = 0;
  output.forEach((row, index) => {
    const branchDebt = Math.max(0, toNumber(row[11]));
    const amount = index === output.length - 1
      ? target - allocated
      : Math.round(branchDebt * ratio);
    allocated += amount;
    row.push(
      amount,
      ratio,
      `Закрытие кассового разрыва ${cashGap.toLocaleString('ru-RU')} ₽; общая цель сбора ${target.toLocaleString('ru-RU')} ₽/день`
    );
  });
  return target;
}

export function buildRopTasksToday({ morningValues, taskDate, financeCollectionTarget = 0, financeCashGap = 0 } = {}) {
  const task = dateOnly(taskDate);
  if (!task) throw new Error('taskDate must be YYYY-MM-DD');
  const idx = indexHeaders(morningValues);
  const rows = chooseSourceRows(morningValues, idx, task)
    .filter(row => ['СЕГОДНЯ', 'КОНТРОЛЬ'].includes(text(row[idx.get('Приоритет')])))
    .filter(row => toNumber(row[idx.get('Дефицит к плану на дату')]) > 0);

  const byBranch = new Map();
  for (const row of rows) {
    const branch = text(row[idx.get('Филиал')]);
    if (!branch) continue;
    const existing = byBranch.get(branch);
    if (!existing) {
      byBranch.set(branch, { first: row, managers: new Set([text(row[idx.get('Менеджер')])]) });
    } else {
      assertConsistent(existing.first, row, idx);
      existing.managers.add(text(row[idx.get('Менеджер')]));
    }
  }

  const output = [];
  for (const [branch, group] of byBranch.entries()) {
    const row = group.first;
    const priority = text(row[idx.get('Приоритет')]);
    const reportDate = dateOnly(row[idx.get('Дата отчёта')]);
    const managers = [...group.managers].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru'));
    const sourceNote = text(row[idx.get('Примечание')]);
    const sharedNote = managers.length > 1 ? 'Общий филиальный дефицит; сумма не задваивается между менеджерами.' : '';
    output.push([
      task,
      reportDate,
      priority,
      branch,
      managers.join('; '),
      roundMoney(toNumber(row[idx.get('План месяца')])),
      roundMoney(toNumber(row[idx.get('План к дате')])),
      roundMoney(toNumber(row[idx.get(factHeader(idx))])),
      roundMoney(toNumber(row[idx.get('Факт с начала месяца')])),
      roundMoney(toNumber(row[idx.get('Дефицит к плану на дату')])),
      roundMoney(toNumber(row[idx.get('Прогноз месяца')])),
      roundMoney(toNumber(row[idx.get('Текущая ДЗ')])),
      text(row[idx.get('Задача старшей')]),
      `${task} 20:30`,
      executionStatus(priority),
      [sharedNote, sourceNote].filter(Boolean).join(' ')
    ]);
  }

  output.sort((a, b) => rank(a[2]) - rank(b[2]) || b[9] - a[9] || String(a[3]).localeCompare(String(b[3]), 'ru'));
  const appliedFinanceTarget = allocateCollectionTarget(output, financeCollectionTarget, financeCashGap);
  const reportDates = [...new Set(output.map(row => row[1]).filter(Boolean))];
  if (reportDates.length > 1) throw new Error('ROP tasks source contains multiple report dates');

  return {
    taskDate: task,
    reportDate: reportDates[0] || '',
    values: [HEADERS, ...output],
    metrics: {
      tasks: output.length,
      today: output.filter(row => row[2] === 'СЕГОДНЯ').length,
      control: output.filter(row => row[2] === 'КОНТРОЛЬ').length,
      totalDeficit: roundMoney(output.reduce((sum, row) => sum + toNumber(row[9]), 0)),
      financeCollectionTarget: appliedFinanceTarget
    }
  };
}

const DEBTOR_HEADERS = [
  '№','Приоритет филиала','Филиал','Дефицит филиала','ДЗ филиала','StudentId','Курсант','Договор',
  'Открыть в АШК','Менеджер АШК','Ответственный','Долг','Последняя оплата','Причина приоритета',
  'Инструмент','Первое сообщение','Следующий шаг','Срок','Результат контакта','Обещанная сумма',
  'Обещанная дата','Комментарий'
];

const ASHK_CONTRACTS_URL = 'https://app.dscontrol.ru/#!/app/student.list';

function moneyText(value) {
  return `${Math.round(toNumber(value)).toLocaleString('ru-RU')} ₽`;
}

function collectionPlaybook({ studentName, contractName, debt, lastPayment, responsible }) {
  const greeting = studentName ? `Здравствуйте, ${studentName}!` : 'Здравствуйте!';
  const contract = contractName ? ` по договору ${contractName}` : '';
  const assignment = responsible === 'СТАРШАЯ — НАЗНАЧИТЬ'
    ? 'Старшая сначала назначает ответственного. '
    : '';
  return {
    instrument: lastPayment ? 'Звонок + WhatsApp + частичная оплата' : 'Звонок + WhatsApp + частичная оплата + контроль старшей',
    message: `${greeting} Напоминаем: задолженность${contract} — ${moneyText(debt)}. Подскажите, какую сумму сможете внести сегодня? При необходимости можно начать с частичной оплаты.`,
    nextStep: `${assignment}Если нет оплаты или ответа — повторный звонок через 2 часа; затем зафиксировать обещанную сумму и дату или передать старшей на эскалацию.`
  };
}

function normalizedPerson(value) {
  return text(value).toLocaleLowerCase('ru-RU').split(/\s+/)[0] || '';
}

function headerMap(values, required, label) {
  const headers = Array.isArray(values?.[0]) ? values[0] : [];
  const idx = new Map(headers.map((name, position) => [text(name), position]));
  for (const header of required) {
    if (!idx.has(header)) throw new Error(`${label} missing header: ${header}`);
  }
  return idx;
}

export function buildRopDebtorPriority({ receivablesValues, taskValues, planValues, limitPerBranch = 5 } = {}) {
  const receivableIdx = headerMap(receivablesValues, [
    'StudentId','Курсант','Филиал','Менеджер','Договор','Долг','Последняя оплата'
  ], 'Receivables detail');
  const taskIdx = headerMap(taskValues, [
    'Приоритет','Филиал','Дефицит, ₽','Срок'
  ], 'ROP tasks');
  const planIdx = headerMap(planValues, [
    'Менеджер','Филиал','Филиал АШК','Активен'
  ], 'ROP plan');
  const maxRows = Math.max(1, Math.trunc(toNumber(limitPerBranch)) || 5);

  const branchByAshk = new Map();
  const managersByBranch = new Map();
  for (const row of Array.isArray(planValues) ? planValues.slice(1) : []) {
    if (text(row[planIdx.get('Активен')]).toLocaleLowerCase('ru-RU') !== 'да') continue;
    const branch = text(row[planIdx.get('Филиал')]);
    const ashkBranch = text(row[planIdx.get('Филиал АШК')]);
    const manager = text(row[planIdx.get('Менеджер')]);
    if (ashkBranch && branch) branchByAshk.set(ashkBranch, branch);
    if (branch && manager) {
      const managers = managersByBranch.get(branch) || [];
      managers.push(manager);
      managersByBranch.set(branch, managers);
    }
  }

  const problems = (Array.isArray(taskValues) ? taskValues.slice(1) : [])
    .filter(row => ['СЕГОДНЯ', 'КОНТРОЛЬ'].includes(text(row[taskIdx.get('Приоритет')])) )
    .filter(row => toNumber(row[taskIdx.get('Дефицит, ₽')]) > 0)
    .map(row => ({
      priority: text(row[taskIdx.get('Приоритет')]),
      branch: text(row[taskIdx.get('Филиал')]),
      deficit: roundMoney(toNumber(row[taskIdx.get('Дефицит, ₽')])),
      deadline: text(row[taskIdx.get('Срок')])
    }))
    .sort((a, b) => rank(a.priority) - rank(b.priority) || b.deficit - a.deficit || a.branch.localeCompare(b.branch, 'ru'));

  const debtorsByBranch = new Map();
  for (const row of Array.isArray(receivablesValues) ? receivablesValues.slice(1) : []) {
    const debt = roundMoney(toNumber(row[receivableIdx.get('Долг')]));
    if (!(debt > 0)) continue;
    const ashkBranch = text(row[receivableIdx.get('Филиал')]);
    const branch = branchByAshk.get(ashkBranch) || ashkBranch;
    const list = debtorsByBranch.get(branch) || [];
    list.push({ row, debt });
    debtorsByBranch.set(branch, list);
  }

  const output = [];
  for (const problem of problems) {
    const allDebtors = (debtorsByBranch.get(problem.branch) || [])
      .sort((a, b) => b.debt - a.debt || Number(a.row[receivableIdx.get('StudentId')]) - Number(b.row[receivableIdx.get('StudentId')]));
    const branchDebt = roundMoney(allDebtors.reduce((sum, item) => sum + item.debt, 0));
    const activeManagers = managersByBranch.get(problem.branch) || [];
    for (const item of allDebtors.slice(0, maxRows)) {
      const owner = text(item.row[receivableIdx.get('Менеджер')]);
      const responsible = activeManagers.find(manager => normalizedPerson(manager) === normalizedPerson(owner))
        || 'СТАРШАЯ — НАЗНАЧИТЬ';
      const lastPayment = dateOnly(item.row[receivableIdx.get('Последняя оплата')]);
      const studentName = text(item.row[receivableIdx.get('Курсант')]);
      const contractName = text(item.row[receivableIdx.get('Договор')]);
      const reasons = [`Дефицит филиала ${Math.round(problem.deficit).toLocaleString('ru-RU')} ₽`, 'крупный долг'];
      if (!lastPayment) reasons.push('нет последней оплаты');
      if (responsible === 'СТАРШАЯ — НАЗНАЧИТЬ') reasons.push('менеджер АШК вне текущего плана');
      const playbook = collectionPlaybook({ studentName, contractName, debt: item.debt, lastPayment, responsible });
      output.push([
        output.length + 1,
        problem.priority,
        problem.branch,
        problem.deficit,
        branchDebt,
        Number(item.row[receivableIdx.get('StudentId')]),
        studentName,
        contractName,
        ASHK_CONTRACTS_URL,
        owner,
        responsible,
        item.debt,
        lastPayment,
        reasons.join('; '),
        playbook.instrument,
        playbook.message,
        playbook.nextStep,
        problem.deadline,
        '',
        '',
        '',
        ''
      ]);
    }
  }

  return {
    values: [DEBTOR_HEADERS, ...output],
    metrics: {
      rows: output.length,
      branches: new Set(output.map(row => row[2])).size,
      prioritizedDebt: roundMoney(output.reduce((sum, row) => sum + toNumber(row[11]), 0))
    }
  };
}