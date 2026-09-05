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

test('current backlog wording keeps Decision Engine fail-closed while four Tochka operations are outside DDS', () => {
  const snapshot = parseDataHealthSnapshot(liveRows());
  const health = evaluateDataHealthSnapshot(snapshot);

  assert.deepEqual(snapshot.tochkaDds, { missingToday: 4 });
  assert.equal(health.ok, false);
  assert.equal(health.status, 'BLOCKED');
  assert.ok(health.consistencyErrors.includes('tochka dds coverage incomplete'));
});
