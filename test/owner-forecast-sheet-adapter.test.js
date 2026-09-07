import test from 'node:test';
import assert from 'node:assert/strict';

async function loadAdapter() {
  try {
    const module = await import('../lib/owner-forecast-sheet-adapter.js');
    return module.createOwnerForecastSheetAdapter;
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined;
    throw error;
  }
}

function forecastValues() {
  return [
    ['ПРОГНОЗ ДЕНЕГ — 30 ДНЕЙ', 'MVP v1', 'Горизонт', 2],
    ['Стартовый остаток', 144084],
    ['Дата', 'Остаток на начало', 'Поступления всего', 'Выплаты всего', 'Резерв / блокировка'],
    [46273, -138216.02, 275931.40275, 92718, 16831.81556775],
    [46274, 44997.38275, 245667.79575, 0, 31817.5511085]
  ];
}

test('reads exactly the bounded live forecast range as unformatted values and parses it', async () => {
  const createOwnerForecastSheetAdapter = await loadAdapter();
  assert.equal(typeof createOwnerForecastSheetAdapter, 'function');

  const calls = [];
  const source = forecastValues();
  const before = structuredClone(source);
  const sheets = {
    spreadsheets: {
      values: {
        async get(args) {
          calls.push(args);
          return { data: { values: source } };
        }
      }
    }
  };

  const adapter = createOwnerForecastSheetAdapter({
    sheets,
    spreadsheetId: 'sheet-123'
  });
  const result = await adapter.readOwnerForecast();

  assert.deepEqual(calls, [{
    spreadsheetId: 'sheet-123',
    range: "'Прогноз 30 дней'!A1:R34",
    valueRenderOption: 'UNFORMATTED_VALUE'
  }]);
  assert.deepEqual(result, {
    availableCash: 144084,
    horizonDays: 2,
    openingCash: -138216.02,
    flows: [
      { date: '2026-09-08', inflow: 275931.40275, outflow: 92718 },
      { date: '2026-09-09', inflow: 245667.79575, outflow: 0 }
    ],
    protectedReserves: [
      { date: '2026-09-08', amount: 16831.81556775 },
      { date: '2026-09-09', amount: 31817.5511085 }
    ]
  });
  assert.deepEqual(source, before);
});
