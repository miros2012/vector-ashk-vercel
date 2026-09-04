import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDataHealthSnapshot } from '../lib/data-health-snapshot.js';

const HEADER = ['Контур', 'Метрика', 'Значение', 'Статус', 'Источник', 'Дата источника', 'Комментарий'];

test('parses finance data health metrics without relying on fixed row numbers', () => {
  const rows = [
    HEADER,
    ['Банк', 'Рабочий баланс, ₽', 1658129, 'INFO'],
    ['Касса', 'Филиалов всего', 9, 'INFO'],
    ['Касса', 'Свежих фактов ≤2 дн.', 7, 'RISK'],
    ['Касса', 'Устаревших / нет факта', 2, 'RISK'],
    ['Касса', 'Строк с расхождением / проверкой', 1, 'REVIEW'],
    ['Касса', 'Фактическая наличность по доступным фактам, ₽', 68463, 'INFO'],
    ['Касса', 'Последних строк не перенесено', 0, 'OK'],
    ['Касса', 'Устаревшие филиалы', 'Мельникайте, Монтажников', 'RISK'],
    ['Касса', 'Филиалы с расхождением / проверкой', 'Сити-молл', 'REVIEW'],
    ['Банк', 'Точка — LIVE счета', '5/5', 'OK'],
    ['Обязательства', 'Неподтверждённых', 0, 'OK'],
    ['Прогноз', 'Кассовый разрыв 30 дней, ₽', 689819.5275, 'RISK'],
    ['Продажи', 'РОП — дефицит к плану на дату, ₽', 716348.47, 'RISK'],
    ['Дебиторка', 'Текущая дебиторка, ₽', 3069255, 'INFO'],
    ['Фонд вождения', 'Дефицит фонда, ₽', 1336658.02, 'REVIEW'],
    ['Система', 'Общий статус', 'RISK', 'RISK']
  ];

  const snapshot = parseDataHealthSnapshot(rows);

  assert.equal(snapshot.valid, true);
  assert.deepEqual(snapshot.consistencyErrors, []);
  assert.deepEqual(snapshot.cash, {
    branchesTotal: 9,
    freshFacts: 7,
    staleFacts: 2,
    reviewRows: 1,
    availableCash: 68463,
    latestRowsNotTransferred: 0,
    staleBranches: 'Мельникайте, Монтажников',
    reviewBranches: 'Сити-молл'
  });
  assert.deepEqual(snapshot.bank, { liveAccounts: '5/5', workingBalance: 1658129 });
  assert.deepEqual(snapshot.obligations, { unconfirmed: 0 });
  assert.deepEqual(snapshot.forecast, { cashGap30d: 689819.5275 });
  assert.deepEqual(snapshot.sales, { ropDeficitToDate: 716348.47 });
  assert.deepEqual(snapshot.receivables, { current: 3069255 });
  assert.deepEqual(snapshot.drivingFund, { deficit: 1336658.02 });
  assert.equal(snapshot.systemStatus, 'RISK');
});

test('parses the current operational Data Health sheet layout and source freshness', () => {
  const rows = [
    ['DATA HEALTH — КОНТРОЛЬ СВЕЖЕСТИ ИСТОЧНИКОВ', 'Контроль', 'Последний маркер', 'Возраст / отклонение, ч'],
    ['Источник', 'Что проверяем', 'Последний маркер', 'Возраст, ч'],
    ['Точка API', 'timestamp LIVE-остатков', 46269.58, 0.13],
    ['АШК оплаты', 'последняя операция в staging', '2026-09-04 15:32:50', 0],
    ['АШК часы', 'LoadedAt текущего табеля', 46269.05, 12.8],
    ['АШК дебиторка / РОП', 'сегодняшний live-срез города', '2026-09-04', 0],
    ['Прогноз 30 дней', 'старт прогноза = завтра', 46270, 0],
    ['ИТОГО', 'общий статус системы', 46269.58, 5],
    ['Банк', 'Рабочий баланс, ₽', 1675758.2, 'INFO'],
    ['Обязательства', 'Неподтверждённых', 0, 'OK'],
    ['Прогноз', 'Кассовый разрыв 30 дней, ₽', 672190.3275, 'RISK'],
    ['Продажи', 'РОП — дефицит к плану на дату, ₽', 648048.47, 'RISK'],
    ['Дебиторка', 'Текущая дебиторка, ₽', 3069255, 'INFO'],
    ['Фонд вождения', 'Дефицит фонда, ₽', 1327825.72, 'REVIEW'],
    ['Система', 'Общий статус', 'RISK', 'RISK'],
    ['Касса', 'Самый старый факт филиала', 46251, 'RISK'],
    ['Касса', 'Устаревшие филиалы', 'Герцена, Мельникайте, Монтажников', 'RISK'],
    ['Касса', 'Филиалы с расхождением / проверкой', 'Сити-молл', 'REVIEW']
  ];

  const snapshot = parseDataHealthSnapshot(rows);

  assert.equal(snapshot.valid, true);
  assert.equal(snapshot.bank.workingBalance, 1675758.2);
  assert.equal(snapshot.forecast.cashGap30d, 672190.3275);
  assert.equal(snapshot.sales.ropDeficitToDate, 648048.47);
  assert.equal(snapshot.receivables.current, 3069255);
  assert.equal(snapshot.drivingFund.deficit, 1327825.72);
  assert.equal(snapshot.systemStatus, 'RISK');
  assert.deepEqual(snapshot.sources, {
    bank: { ageHours: 0.13, marker: 46269.58 },
    payments: { ageHours: 0, marker: '2026-09-04 15:32:50' },
    hours: { ageHours: 12.8, marker: 46269.05 },
    receivables: { ageHours: 0, marker: '2026-09-04' },
    forecast: { ageHours: 0, marker: 46270 }
  });
  assert.equal(snapshot.cash.staleBranches, 'Герцена, Мельникайте, Монтажников');
  assert.equal(snapshot.cash.reviewBranches, 'Сити-молл');
});

test('marks cash freshness totals invalid when branch counts do not reconcile', () => {
  const snapshot = parseDataHealthSnapshot([
    HEADER,
    ['Касса', 'Филиалов всего', 9],
    ['Касса', 'Свежих фактов ≤2 дн.', 7],
    ['Касса', 'Устаревших / нет факта', 1]
  ]);

  assert.equal(snapshot.valid, false);
  assert.deepEqual(snapshot.consistencyErrors, ['cash freshness totals do not reconcile']);
});

test('rejects a sheet with an unexpected header', () => {
  assert.throws(
    () => parseDataHealthSnapshot([['wrong', 'header']]),
    /Data Health Snapshot header is invalid/
  );
});
