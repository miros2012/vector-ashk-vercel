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
