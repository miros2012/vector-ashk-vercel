import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRopTasksToday } from '../lib/rop-tasks-today.js';

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
