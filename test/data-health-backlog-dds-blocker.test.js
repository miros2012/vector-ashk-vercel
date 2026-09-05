import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDataHealthSnapshot, evaluateDataHealthSnapshot } from '../lib/data-health-snapshot.js';

function liveRows() {
  return [
    ['DATA HEALTH — КОНТРОЛЬ СВЕЖЕСТИ ИСТОЧНИКОВ', 'Контроль', 'Последний маркер', 'Возраст / отклонение, ч'],
    ['Источник', 'Что проверяем', 'Последний маркер', 'Возраст, ч', 'WARN, ч', 'ERROR, ч', 'Статус'],
    ['Точка API', 'timestamp LIVE-остатков', 46270.41, 0.01, 2, 4, 'OK'],
    ['АШК оплаты', 'последняя успешная синхронизация', '2026-09-05T04:09:37Z', 0.8, 2, 26, 'OK'],
    ['АШК часы', 'LoadedAt текущего табеля', 46270.13, 6.7, 30, 54, 'OK'],
    ['АШК дебиторка / РОП', 'последняя успешная синхронизация', '2026-09-04T22:17:52Z', 6.7, 30, 54, 'OK'],
    ['Прогноз 30 дней', 'старт прогноза = завтра', 46271, 0, 1, 24, 'OK'],
    ['Точка операции', 'последний успешный refresh операций Точки', 46270.41, 0.01, 0.25, 2, 'OK'],
    ['Система', 'Общий статус', 'RISK', 'RISK'],
    ['Филиал', 'Последняя дата журнала', 'Факт наличных, ₽', 'Проверка остатка'],
    ['Точка → ДДС', 'внешних операций не дошло — сегодня + backlog', 4, 'RISK'],
    ['Точка → ДДС', 'ручная классификация, оп. — весь backlog', 4, 'BLOCKER']
  ];
}

function queueMismatchRows() {
  return [
    ['DATA HEALTH — КОНТРОЛЬ СВЕЖЕСТИ ИСТОЧНИКОВ', 'Контроль', 'Последний маркер', 'Возраст / отклонение, ч'],
    ['Источник', 'Что проверяем', 'Последний маркер', 'Возраст, ч', 'WARN, ч', 'ERROR, ч', 'Статус'],
    ['Точка API', 'timestamp LIVE-остатков', 46270.41, 0.01, 2, 4, 'OK'],
    ['АШК оплаты', 'последняя успешная синхронизация', '2026-09-05T04:09:37Z', 0.8, 2, 26, 'OK'],
    ['АШК часы', 'LoadedAt текущего табеля', 46270.13, 6.7, 30, 54, 'OK'],
    ['АШК дебиторка / РОП', 'последняя успешная синхронизация', '2026-09-04T22:17:52Z', 6.7, 30, 54, 'OK'],
    ['Прогноз 30 дней', 'старт прогноза = завтра', 46271, 0, 1, 24, 'OK'],
    ['Точка операции', 'последний успешный refresh операций Точки', 46270.41, 0.01, 0.25, 2, 'OK'],
    ['Система', 'Общий статус', 'OK', 'OK'],
    ['Филиал', 'Последняя дата журнала', 'Факт наличных, ₽', 'Проверка остатка'],
    ['Точка → ДДС', 'внешних операций не дошло — сегодня + backlog', 0, 'OK'],
    ['Точка → ДДС', 'ручная классификация, оп. — весь backlog', 0, 'OK'],
    ['Точка → ДДС', 'автоимпорт ожидает, оп. — весь backlog', 4, 'WAIT'],
    ['Точка → ДДС', 'структура очереди — сегодня + backlog', 0, 'CHECK']
  ];
}

test('current backlog wording keeps Decision Engine fail-closed while four Tochka operations are outside DDS', () => {
  const snapshot = parseDataHealthSnapshot(liveRows());
  const health = evaluateDataHealthSnapshot(snapshot);

  assert.deepEqual(snapshot.tochkaDds, { missingToday: 4 });
  assert.equal(health.ok, false);
  assert.equal(health.status, 'BLOCKED');
  assert.ok(health.consistencyErrors.includes('tochka dds coverage incomplete'));
});

test('queue structure CHECK blocks even when a stale coverage formula reports zero missing operations', () => {
  const snapshot = parseDataHealthSnapshot(queueMismatchRows());
  const health = evaluateDataHealthSnapshot(snapshot);

  assert.equal(snapshot.tochkaDds.queueStructureStatus, 'CHECK');
  assert.equal(health.ok, false);
  assert.equal(health.status, 'BLOCKED');
  assert.ok(health.consistencyErrors.includes('tochka dds queue structure inconsistent'));
});

test('present queue structure row with a blank status also fails closed', () => {
  const rows = queueMismatchRows();
  rows.at(-1)[3] = '';

  const snapshot = parseDataHealthSnapshot(rows);
  const health = evaluateDataHealthSnapshot(snapshot);

  assert.equal(Object.hasOwn(snapshot.tochkaDds, 'queueStructureStatus'), true);
  assert.equal(snapshot.tochkaDds.queueStructureStatus, '');
  assert.equal(health.ok, false);
  assert.equal(health.status, 'BLOCKED');
  assert.ok(health.consistencyErrors.includes('tochka dds queue structure inconsistent'));
});
