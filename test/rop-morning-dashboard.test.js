import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRopMorningDashboard } from '../lib/rop-morning-dashboard.js';

const CONTROL_VALUES = [
  ['Дата','Менеджер','Филиал','План филиала на месяц','План филиала к дате','Факт филиала за день','Факт филиала с начала месяца','Выполнение плана филиала','Контрольный план менеджера на месяц','Контрольный план менеджера к дате','Личный факт за день','Личный факт с начала месяца','Выполнение личного плана','Новых договоров с начала месяца','100% оплаченных новых договоров','Текущая ДЗ филиала','Статус филиала','Статус личный','Примечание'],
  ['2026-09-01','Менеджер А','Зарека',1110000,40259.07,46600,46600,1.1575,1110000,40259.07,46600,46600,1.1575,1,1,655450,'ЗЕЛЁНЫЙ','ЗЕЛЁНЫЙ',''],
  ['2026-09-01','Менеджер Б','Герцена',3800000,97435.9,50000,50000,0.5132,1900000,48717.95,30000,30000,0.6158,1,0,660794,'КРАСНЫЙ','КРАСНЫЙ','общий филиальный план'],
  ['2026-09-01','Менеджер В','Герцена',3800000,97435.9,50000,50000,0.5132,1900000,48717.95,0,0,0,0,0,660794,'КРАСНЫЙ','КРАСНЫЙ','общий филиальный план'],
  ['2026-09-02','Менеджер А','Зарека',1110000,97772.02,0,46600,0.4766,1110000,97772.02,0,46600,0.4766,1,1,655450,'КРАСНЫЙ','КРАСНЫЙ',''],
  ['2026-09-02','Менеджер Б','Герцена',3800000,236630.04,1500,51500,0.2176,1900000,118315.02,0,30000,0.2536,1,0,660794,'КРАСНЫЙ','КРАСНЫЙ','общий филиальный план'],
  ['2026-09-02','Менеджер В','Герцена',3800000,236630.04,1500,51500,0.2176,1900000,118315.02,0,0,0,0,0,660794,'КРАСНЫЙ','КРАСНЫЙ','общий филиальный план']
];

test('morning dashboard keeps closed snapshot and adds current live snapshot', () => {
  const dashboard = buildRopMorningDashboard({ controlValues: CONTROL_VALUES, asOfDate: '2026-09-02' });
  assert.equal(dashboard.reportDate, '2026-09-01');
  assert.equal(dashboard.liveDate, '2026-09-02');
  const headers = dashboard.values[0];
  const idx = name => headers.indexOf(name);
  const rows = dashboard.values.slice(1);
  const closedA = rows.find(row => row[idx('Срез')] === 'ВЧЕРА — ЗАКРЫТО' && row[idx('Менеджер')] === 'Менеджер А');
  const liveA = rows.find(row => row[idx('Срез')] === 'СЕГОДНЯ — НА СЕЙЧАС' && row[idx('Менеджер')] === 'Менеджер А');
  const closedB = rows.find(row => row[idx('Срез')] === 'ВЧЕРА — ЗАКРЫТО' && row[idx('Менеджер')] === 'Менеджер Б');
  assert.ok(closedA && liveA && closedB);
  assert.equal(closedA[idx('Факт филиала за день')], 46600);
  assert.equal(closedA[idx('Дефицит филиала к плану на дату')], 0);
  assert.equal(closedB[idx('Дефицит филиала к плану на дату')], 47435.9);
  assert.equal(liveA[idx('Факт филиала за день')], 0);
  assert.equal(liveA[idx('Факт филиала с начала месяца')], 46600);
  assert.equal(liveA[idx('Приоритет')], 'СЕГОДНЯ');
});

test('first day can expose only the current live snapshot', () => {
  const dashboard = buildRopMorningDashboard({
    controlValues: CONTROL_VALUES.filter(row => row[0] === 'Дата' || row[0] === '2026-09-01'),
    asOfDate: '2026-09-01'
  });
  assert.equal(dashboard.reportDate, '2026-09-01');
  assert.equal(dashboard.liveDate, '2026-09-01');
});

test('morning dashboard exposes personal plan completion and color for every manager', () => {
  const dashboard = buildRopMorningDashboard({ controlValues: CONTROL_VALUES, asOfDate: '2026-09-02' });
  const headers = dashboard.values[0];
  const idx = name => headers.indexOf(name);
  const manager = dashboard.values.slice(1).find(row =>
    row[idx('Срез')] === 'ВЧЕРА — ЗАКРЫТО' && row[idx('Менеджер')] === 'Менеджер Б'
  );

  assert.equal(manager[idx('Выполнение личного плана')], 0.6158);
  assert.equal(manager[idx('Статус личного плана')], 'КРАСНЫЙ');
});

test('city totals include current-month contracts owned by managers outside the active branch roster', () => {
  const currentMonthContractsValues = [
    ['StudentId','Дата договора','Филиал','Филиал АШК','Менеджер АШК','Продажи','Оплачено','Долг','Статус','Договор'],
    [201,'2026-09-01','Герцена','Сити-Центр','Менеджер Б',60000,30000,30000,'DRV','A'],
    [202,'2026-09-01','Герцена','Сити-Центр','Менеджер В',40000,40000,0,'DRV','B'],
    [203,'2026-09-01','Герцена','Сити-Центр','Старый Центр',50000,50000,0,'DRV','C']
  ];

  const dashboard = buildRopMorningDashboard({
    controlValues: CONTROL_VALUES,
    currentMonthContractsValues,
    asOfDate: '2026-09-02'
  });
  const headers = dashboard.values[0];
  const idx = name => headers.indexOf(name);
  const closedCity = dashboard.values.slice(1).find(row =>
    row[idx('Срез')] === 'ВЧЕРА — ЗАКРЫТО' && row[idx('Уровень')] === 'ГОРОД'
  );

  assert.equal(closedCity[idx('Новых договоров')], 3);
  assert.equal(closedCity[idx('100% оплат новых договоров')], 2);
});
