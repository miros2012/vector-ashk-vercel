import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDataHealthSnapshot, parseDataHealthSnapshot } from '../lib/data-health-snapshot.js';

function operationalRows({ paymentAge = 3, paymentStatus = 'ЗАДЕРЖКА' } = {}) {
  return [
    ['DATA HEALTH — КОНТРОЛЬ СВЕЖЕСТИ ИСТОЧНИКОВ', 'Контроль', 'Последний маркер', 'Возраст / отклонение, ч'],
    ['Источник', 'Что проверяем', 'Последний маркер', 'Возраст, ч', 'WARN, ч', 'ERROR, ч', 'Статус', 'Детали'],
    ['Точка API', 'timestamp LIVE-остатков', 46269.58, 0.5, 2, 4, 'OK'],
    ['АШК оплаты', 'последняя успешная синхронизация', 46269.50, paymentAge, 2, 26, paymentStatus],
    ['АШК часы', 'LoadedAt текущего табеля', 46269.05, 12.8, 30, 54, 'OK'],
    ['АШК дебиторка / РОП', 'последняя успешная синхронизация', 46269.10, 12, 30, 54, 'OK'],
    ['Прогноз 30 дней', 'старт прогноза = завтра', 46270, 0, 1, 24, 'OK'],
    ['ИТОГО', 'свежесть пяти ключевых источников', 46269.58, 4, 5, 1, paymentStatus],
    ['Точка операции', 'последняя загрузка Точка_API', 46269.57, 0.6, 0.25, 2, 'OK']
  ];
}

test('parses source warning/error thresholds and the sheet status', () => {
  const snapshot = parseDataHealthSnapshot(operationalRows());

  assert.deepEqual(snapshot.sources.payments, {
    ageHours: 3,
    marker: 46269.50,
    warnAfterHours: 2,
    errorAfterHours: 26,
    status: 'ЗАДЕРЖКА'
  });
});

test('a delayed source warns but does not block financial decisions', () => {
  const health = evaluateDataHealthSnapshot(parseDataHealthSnapshot(operationalRows()));

  assert.equal(health.ok, true);
  assert.equal(health.status, 'WARNING');
  assert.deepEqual(health.staleCoreSources, []);
  assert.ok(health.warnings.includes('source-delay:payments'));
});

test('a source beyond its error threshold blocks financial decisions', () => {
  const health = evaluateDataHealthSnapshot(parseDataHealthSnapshot(operationalRows({
    paymentAge: 27,
    paymentStatus: 'ОШИБКА'
  })));

  assert.equal(health.ok, false);
  assert.equal(health.status, 'BLOCKED');
  assert.ok(health.staleCoreSources.includes('payments'));
});

test('an explicit source error blocks even when the numeric age is still small', () => {
  const health = evaluateDataHealthSnapshot(parseDataHealthSnapshot(operationalRows({
    paymentAge: 0.5,
    paymentStatus: 'ОШИБКА'
  })));

  assert.equal(health.ok, false);
  assert.ok(health.staleCoreSources.includes('payments'));
});
