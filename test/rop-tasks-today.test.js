import test from 'node:test';
import assert from 'node:assert/strict';
import * as ropTasks from '../lib/rop-tasks-today.js';

const { buildRopTasksToday } = ropTasks;

const MORNING_VALUES = [
  ['Дата отчёта','Уровень','Менеджер','Филиал','План месяца','План к дате','Факт вчера','Факт с начала месяца','Выполнение','Дефицит к плану на дату','Прогноз месяца','Отклонение прогноза','Контрольный план менеджера','Личный факт вчера','Личный факт с начала месяца','Новых договоров','100% оплат новых договоров','Текущая ДЗ','Приоритет','Задача старшей','Примечание'],
  ['2026-09-01','ГОРОД','','Все филиалы',10560000,329863.16,337900,337900,1.02,0,11908385.52,1348385.52,'','','',6,5,3138754,'ОК','Удержать темп города',''],
  ['2026-09-01','МЕНЕДЖЕР','Гыско Лада','Гондатти',1200000,30769.23,16800,16800,0.546,13969.23,655200.02,-544799.98,600000,13300,13300,0,0,234300,'СЕГОДНЯ','Добрать 13 969 ₽','Общий филиальный план'],
  ['2026-09-01','МЕНЕДЖЕР','Жданова Алена','Гондатти',1200000,30769.23,16800,16800,0.546,13969.23,655200.02,-544799.98,600000,3500,3500,0,0,234300,'СЕГОДНЯ','Добрать 13 969 ₽','Общий филиальный план'],
  ['2026-09-01','МЕНЕДЖЕР','Губкина Евгения','Мельникайте',750000,27202.07,12200,12200,0.4485,15002.07,336371.46,-413628.54,750000,12200,12200,0,0,320717,'СЕГОДНЯ','Добрать 15 002 ₽',''],
  ['2026-09-01','МЕНЕДЖЕР','Самусь Анастасия','Зарека',1110000,40259.07,46600,46600,1.1575,0,1284828.49,174828.49,1110000,46600,46600,1,1,655450,'ОК','Удержать темп','']
];

test('tasks today deduplicates shared branch deficit and keeps only actionable priorities', () => {
  const result = buildRopTasksToday({ morningValues: MORNING_VALUES, taskDate: '2026-09-02' });
  assert.equal(result.taskDate, '2026-09-02');
  assert.equal(result.reportDate, '2026-09-01');
  assert.equal(result.values.length, 3); // header + two branch tasks

  const headers = result.values[0];
  const idx = name => headers.indexOf(name);
  const rows = result.values.slice(1);
  const gondatti = rows.find(row => row[idx('Филиал')] === 'Гондатти');
  const melnikayte = rows.find(row => row[idx('Филиал')] === 'Мельникайте');

  assert.ok(gondatti);
  assert.equal(gondatti[idx('Дефицит, ₽')], 13969.23);
  assert.equal(gondatti[idx('Ответственные')], 'Гыско Лада; Жданова Алена');
  assert.equal(gondatti[idx('Приоритет')], 'СЕГОДНЯ');
  assert.equal(gondatti[idx('Статус исполнения')], 'К РАБОТЕ');
  assert.equal(gondatti[idx('Срок')], '2026-09-02 20:30');
  assert.match(gondatti[idx('Задача')], /13.?969.*₽/i);

  assert.ok(melnikayte);
  assert.equal(melnikayte[idx('Ответственные')], 'Губкина Евгения');
  assert.equal(melnikayte[idx('Дефицит, ₽')], 15002.07);

  assert.equal(rows.some(row => row[idx('Филиал')] === 'Зарека'), false);
  assert.equal(result.metrics.tasks, 2);
  assert.equal(result.metrics.totalDeficit, 28971.3);
});

test('tasks today carries CONTROL priority without escalating it to TODAY', () => {
  const control = MORNING_VALUES.map(row => [...row]);
  control.push(['2026-09-01','МЕНЕДЖЕР','Менеджер Контроль','Республики',300000,20000,19000,19000,0.95,1000,285000,-15000,300000,19000,19000,1,1,100000,'КОНТРОЛЬ','Добрать 1 000 ₽','']);
  const result = buildRopTasksToday({ morningValues: control, taskDate: '2026-09-02' });
  const headers = result.values[0];
  const idx = name => headers.indexOf(name);
  const row = result.values.slice(1).find(item => item[idx('Филиал')] === 'Республики');
  assert.equal(row[idx('Приоритет')], 'КОНТРОЛЬ');
  assert.equal(row[idx('Статус исполнения')], 'КОНТРОЛЬ');
});

test('debtor priority lists the largest debtors for problem branches and flags stale ownership', () => {
  assert.equal(typeof ropTasks.buildRopDebtorPriority, 'function');
  const receivablesValues = [
    ['StudentId','Курсант','GroupId','Филиал','Менеджер','Договор','Дата договора','Статус','Продажи','Оплачено','Долг','Долг основной услуги','Основная услуга','Последняя оплата'],
    [101,'Иванов Иван',1,'Фармана Салманова','Кумаритова Алина','A','2026-08-01','DRV',50000,5000,45000,45000,'Курс','2026-08-01'],
    [102,'Петров Пётр',1,'Фармана Салманова','Старый Менеджер','B','2026-07-01','DRV',40000,0,40000,40000,'Курс',''],
    [103,'Сидоров Семён',1,'Фармана Салманова','Кумаритова Алина','C','2026-08-02','DRV',30000,5000,25000,25000,'Курс','2026-08-02'],
    [201,'Орлов Олег',2,'Сити-Центр','Кузнецова Марина','D','2026-08-03','DRV',30000,0,30000,30000,'Курс','']
  ];
  const planValues = [
    ['Менеджер','Филиал','Филиал АШК','План филиала','Контрольный план менеджера','График','Активен','Примечание'],
    ['Кумаритова Алина','Салмана','Фармана Салманова',800000,800000,'5/2','Да',''],
    ['Кузнецова Марина','Герцена','Сити-Центр',3800000,1900000,'2/2','Да','']
  ];
  const taskValues = [
    ['Дата задачи','Дата отчёта','Приоритет','Филиал','Ответственные','План месяца','План к дате','Факт сегодня','Факт с начала месяца','Дефицит, ₽','Прогноз месяца','Текущая ДЗ','Задача','Срок','Статус исполнения','Примечание'],
    ['2026-09-03','2026-09-03','СЕГОДНЯ','Салмана','Кумаритова Алина',800000,100000,0,5000,95000,40000,110000,'Добрать','2026-09-03 20:30','К РАБОТЕ',''],
    ['2026-09-03','2026-09-03','КОНТРОЛЬ','Герцена','Кузнецова Марина',3800000,330000,0,332000,0,3800000,30000,'Удержать','2026-09-03 20:30','КОНТРОЛЬ','']
  ];

  const result = ropTasks.buildRopDebtorPriority({
    receivablesValues,
    taskValues,
    planValues,
    limitPerBranch: 2
  });
  const headers = result.values[0];
  const idx = name => headers.indexOf(name);
  const rows = result.values.slice(1);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row[idx('StudentId')]), [101, 102]);
  assert.equal(rows[0][idx('Филиал')], 'Салмана');
  assert.equal(rows[0][idx('Курсант')], 'Иванов Иван');
  assert.equal(rows[0][idx('Открыть в АШК')], 'https://app.dscontrol.ru/#!/app/student.list');
  assert.equal(rows[0][idx('Долг')], 45000);
  assert.equal(rows[1][idx('Ответственный')], 'СТАРШАЯ — НАЗНАЧИТЬ');
  assert.match(rows[1][idx('Причина приоритета')], /нет последней оплаты/i);
  assert.match(rows[1][idx('Причина приоритета')], /вне текущего плана/i);
  assert.match(rows[0][idx('Инструмент')], /звонок/i);
  assert.match(rows[0][idx('Первое сообщение')], /45.?000.*частич/i);
  assert.match(rows[1][idx('Следующий шаг')], /2 час/i);
  assert.equal(rows[0][idx('Результат контакта')], '');
  assert.equal(rows[0][idx('Обещанная сумма')], '');
  assert.equal(rows[0][idx('Обещанная дата')], '');
  assert.equal(rows[0][idx('Комментарий')], '');
});
