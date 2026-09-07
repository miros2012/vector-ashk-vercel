import test from 'node:test';
import assert from 'node:assert/strict';

async function loadParser() {
  try {
    const module = await import('../lib/owner-forecast-sheet-parser.js');
    return module.parseOwnerForecastSheetValues;
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined;
    throw error;
  }
}

function liveRows() {
  return [
    ['unrelated preamble'],
    ['ПРОГНОЗ ДЕНЕГ — 30 ДНЕЙ', 'MVP v1', 'Горизонт', 2],
    ['Стартовый остаток', 55781],
    ['another unrelated row'],
    ['Статус', 'Дата', 'Выплаты всего', 'Резерв / блокировка', 'Поступления всего', 'Остаток на начало'],
    ['🔴 Разрыв', 46273, 92718, 16831.81556775, 275931.40275, -759019.02],
    ['🔴 Разрыв', 46274, 0, 31817.5511085, 245667.79575, -575805.61725]
  ];
}

test('parses live forecast facts by labels and keeps protected reserves out of cash outflows', async () => {
  const parseOwnerForecastSheetValues = await loadParser();
  assert.equal(typeof parseOwnerForecastSheetValues, 'function');

  const result = parseOwnerForecastSheetValues(liveRows());

  assert.deepEqual(result, {
    availableCash: 55781,
    horizonDays: 2,
    openingCash: -759019.02,
    flows: [
      { date: '2026-09-08', inflow: 275931.40275, outflow: 92718 },
      { date: '2026-09-09', inflow: 245667.79575, outflow: 0 }
    ],
    protectedReserves: [
      { date: '2026-09-08', amount: 16831.81556775 },
      { date: '2026-09-09', amount: 31817.5511085 }
    ]
  });
});

test('rejects negative actual available cash while keeping projected opening signed', async () => {
  const parseOwnerForecastSheetValues = await loadParser();
  const rows = liveRows();
  rows[2][1] = -1;

  assert.throws(
    () => parseOwnerForecastSheetValues(rows),
    /availableCash.*non-negative/i
  );
});
