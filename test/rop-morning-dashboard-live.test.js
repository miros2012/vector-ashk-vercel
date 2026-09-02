import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRopMorningDashboard } from '../lib/rop-morning-dashboard.js';

const CONTROL_VALUES = [
  ['Дата','Менеджер','Филиал','План филиала на месяц','План филиала к дате','Факт филиала за день','Факт филиала с начала месяца','Выполнение плана филиала','Контрольный план менеджера на месяц','Контрольный план менеджера к дате','Личный факт за день','Личный факт с начала месяца','Выполнение личного темпа','Новых договоров с начала месяца','100% оплаченных новых договоров','Текущая ДЗ филиала','Статус филиала','Статус личный','Примечание'],
  ['2026-09-01','Менеджер А','Зарека',1110000,40259.07,46600,46600,1.1575,1110000,40259.07,46600,46600,1.1575,1,1,655450,'ЗЕЛЁНЫЙ','ЗЕЛЁНЫЙ',''],
  ['2026-09-02','Менеджер А','Зарека',1110000,97772.02,27000,73600,0.7528,1110000,97772.02,27000,73600,0.7528,2,1,640000,'КРАСНЫЙ','КРАСНЫЙ','']
];

test('morning dashboard contains both closed yesterday and live today snapshots', () => {
  const dashboard = buildRopMorningDashboard({ controlValues: CONTROL_VALUES, asOfDate: '2026-09-02' });
  const headers = dashboard.values[0];
  const idx = name => headers.indexOf(name);
  assert.ok(idx('Срез') >= 0);
  assert.ok(idx('Факт дня') >= 0);

  const rows = dashboard.values.slice(1);
  const closed = rows.find(row => row[idx('Срез')] === 'ВЧЕРА — ЗАКРЫТО' && row[idx('Уровень')] === 'МЕНЕДЖЕР');
  const live = rows.find(row => row[idx('Срез')] === 'СЕГОДНЯ — НА СЕЙЧАС' && row[idx('Уровень')] === 'МЕНЕДЖЕР');

  assert.ok(closed);
  assert.equal(closed[idx('Дата отчёта')], '2026-09-01');
  assert.equal(closed[idx('Факт дня')], 46600);
  assert.equal(closed[idx('Факт с начала месяца')], 46600);

  assert.ok(live);
  assert.equal(live[idx('Дата отчёта')], '2026-09-02');
  assert.equal(live[idx('Факт дня')], 27000);
  assert.equal(live[idx('Факт с начала месяца')], 73600);
  assert.equal(live[idx('Дефицит к плану на дату')], 24172.02);
  assert.equal(live[idx('Приоритет')], 'СЕГОДНЯ');

  assert.equal(dashboard.reportDate, '2026-09-01');
  assert.equal(dashboard.liveDate, '2026-09-02');
});
