import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRopMorningDashboard } from '../lib/rop-morning-dashboard.js';

const CONTROL_VALUES = [
  ['Дата','Менеджер','Филиал','План филиала на месяц','План филиала к дате','Факт филиала за день','Факт филиала с начала месяца','Выполнение плана филиала','Контрольный план менеджера на месяц','Контрольный план менеджера к дате','Личный факт за день','Личный факт с начала месяца','Выполнение личного темпа','Новых договоров с начала месяца','100% оплаченных новых договоров','Текущая ДЗ филиала','Статус филиала','Статус личный','Примечание'],
  ['2026-09-01','Менеджер А','Зарека',1110000,40259.07,46600,46600,1.1575,1110000,40259.07,46600,46600,1.1575,1,1,655450,'ЗЕЛЁНЫЙ','ЗЕЛЁНЫЙ',''],
  ['2026-09-01','Менеджер Б','Герцена',3800000,97435.9,50000,50000,0.5132,1900000,48717.95,30000,30000,0.6158,1,0,660794,'КРАСНЫЙ','ИНФО','общий филиальный план'],
  ['2026-09-01','Менеджер В','Герцена',3800000,97435.9,50000,50000,0.5132,1900000,48717.95,0,0,0,0,0,660794,'КРАСНЫЙ','ИНФО','общий филиальный план'],
  ['2026-09-02','Менеджер А','Зарека',1110000,97772.02,0,46600,0.4766,1110000,97772.02,0,46600,0.4766,1,1,655450,'КРАСНЫЙ','КРАСНЫЙ',''],
  ['2026-09-02','Менеджер Б','Герцена',3800000,236630.04,1500,51500,0.2176,1900000,118315.02,0,30000,0.2536,1,0,660794,'КРАСНЫЙ','ИНФО','общий филиальный план'],
  ['2026-09-02','Менеджер В','Герцена',3800000,236630.04,1500,51500,0.2176,1900000,118315.02,0,0,0,0,0,660794,'КРАСНЫЙ','ИНФО','общий филиальный план']
];

test('morning dashboard uses the last completed day and shows actionable manager plan-vs-fact', () => {
  const dashboard = buildRopMorningDashboard({ controlValues: CONTROL_VALUES, asOfDate: '2026-09-02' });
  assert.equal(dashboard.reportDate, '2026-09-01');
  const headers = dashboard.values[0];
  const idx = name => headers.indexOf(name);
  const rows = dashboard.values.slice(1);
  const city = rows.find(row => row[idx('Уровень')] === 'ГОРОД');
  const a = rows.find(row => row[idx('Менеджер')] === 'Менеджер А');
  const b = rows.find(row => row[idx('Менеджер')] === 'Менеджер Б');

  assert.ok(city);
  assert.equal(city[idx('План месяца')], 4910000);
  assert.equal(city[idx('Факт с начала месяца')], 96600);
  assert.equal(city[idx('Дефицит к плану на дату')], 51095);

  assert.ok(a);
  assert.equal(a[idx('Дата отчёта')], '2026-09-01');
  assert.equal(a[idx('Факт вчера')], 46600);
  assert.equal(a[idx('Факт с начала месяца')], 46600);
  assert.equal(a[idx('Дефицит к плану на дату')], 0);
  assert.equal(a[idx('Приоритет')], 'ОК');
  assert.match(a[idx('Задача старшей')], /удержать темп/i);

  assert.ok(b);
  assert.equal(b[idx('Факт вчера')], 50000);
  assert.equal(b[idx('Личный факт вчера')], 30000);
  assert.equal(b[idx('Дефицит к плану на дату')], 47435.9);
  assert.equal(b[idx('Приоритет')], 'СЕГОДНЯ');
  assert.match(b[idx('Задача старшей')], /47.?436.*₽/i);
  assert.match(b[idx('Примечание')], /филиальн/i);

  assert.ok(a[idx('Прогноз месяца')] > 1110000);
  assert.ok(b[idx('Прогноз месяца')] < 3800000);
});

test('morning dashboard uses current date on the first day of a month because no prior completed in-month day exists', () => {
  const dashboard = buildRopMorningDashboard({
    controlValues: CONTROL_VALUES.filter(row => row[0] === 'Дата' || row[0] === '2026-09-01'),
    asOfDate: '2026-09-01'
  });
  assert.equal(dashboard.reportDate, '2026-09-01');
});
