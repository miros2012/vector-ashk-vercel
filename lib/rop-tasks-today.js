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
  'Текущая ДЗ','Задача','Срок','Статус исполнения','Примечание'
];

const REQUIRED = [
  'Дата отчёта','Уровень','Менеджер','Филиал','План месяца','План к дате',
  'Факт с начала месяца','Дефицит к плану на дату','Прогноз месяца',
  'Текущая ДЗ','Приоритет','Задача старшей','Примечание'
];

function indexHeaders(values) {
  const headers = Array.isArray(values?.[0]) ? values[0] : [];
  const idx = new Map(headers.map((name, position) => [text(name), position]));
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

export function buildRopTasksToday({ morningValues, taskDate } = {}) {
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
      totalDeficit: roundMoney(output.reduce((sum, row) => sum + toNumber(row[9]), 0))
    }
  };
}
