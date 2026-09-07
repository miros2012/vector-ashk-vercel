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

test('requires horizonDays to be a positive integer number', async () => {
  const parseOwnerForecastSheetValues = await loadParser();

  for (const value of [0, -1, 1.5, '2', Number.POSITIVE_INFINITY]) {
    const rows = liveRows();
    rows[1][3] = value;
    assert.throws(
      () => parseOwnerForecastSheetValues(rows),
      /horizonDays.*positive integer/i,
      String(value)
    );
  }
});

test('requires exactly one horizon and actual-cash label occurrence', async () => {
  const parseOwnerForecastSheetValues = await loadParser();

  const duplicateHorizon = liveRows();
  duplicateHorizon.push(['Горизонт', 2]);
  assert.throws(
    () => parseOwnerForecastSheetValues(duplicateHorizon),
    /Горизонт.*exactly once/i
  );

  const duplicateCash = liveRows();
  duplicateCash.push(['Стартовый остаток', 55781]);
  assert.throws(
    () => parseOwnerForecastSheetValues(duplicateCash),
    /Стартовый остаток.*exactly once/i
  );
});

test('requires exactly one complete daily header with every required header once', async () => {
  const parseOwnerForecastSheetValues = await loadParser();

  const duplicateCell = liveRows();
  duplicateCell[4].push('Дата');
  assert.throws(
    () => parseOwnerForecastSheetValues(duplicateCell),
    /Дата.*exactly once.*header/i
  );

  const duplicateHeader = liveRows();
  duplicateHeader.push([
    'Дата',
    'Остаток на начало',
    'Поступления всего',
    'Выплаты всего',
    'Резерв / блокировка'
  ]);
  assert.throws(
    () => parseOwnerForecastSheetValues(duplicateHeader),
    /daily header.*exactly once/i
  );
});

test('requires the parsed daily row count to equal the declared horizon', async () => {
  const parseOwnerForecastSheetValues = await loadParser();
  const rows = liveRows();
  rows.pop();

  assert.throws(
    () => parseOwnerForecastSheetValues(rows),
    /daily rows.*horizonDays/i
  );
});

test('requires Google Sheets date serials to be finite integer numbers', async () => {
  const parseOwnerForecastSheetValues = await loadParser();

  for (const value of [46273.5, '46273', Number.NaN, Number.POSITIVE_INFINITY]) {
    const rows = liveRows();
    rows[5][1] = value;
    assert.throws(
      () => parseOwnerForecastSheetValues(rows),
      /date serial.*finite integer/i,
      String(value)
    );
  }
});

test('rejects duplicate or non-consecutive forecast dates', async () => {
  const parseOwnerForecastSheetValues = await loadParser();

  const duplicate = liveRows();
  duplicate[6][1] = 46273;
  assert.throws(
    () => parseOwnerForecastSheetValues(duplicate),
    /forecast dates.*duplicate/i
  );

  const gap = liveRows();
  gap[6][1] = 46275;
  assert.throws(
    () => parseOwnerForecastSheetValues(gap),
    /forecast dates.*consecutive/i
  );
});

test('requires projected daily opening cash to be a finite signed number without coercion', async () => {
  const parseOwnerForecastSheetValues = await loadParser();

  for (const value of ['-1', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const rows = liveRows();
    rows[5][5] = value;
    assert.throws(
      () => parseOwnerForecastSheetValues(rows),
      /dailyRows\[0\]\.openingCash.*finite/i,
      String(value)
    );
  }

  const negative = liveRows();
  negative[5][5] = -1;
  assert.equal(parseOwnerForecastSheetValues(negative).openingCash, -1);
});

test('requires inflow, outflow and reserve to be finite non-negative numbers without coercion', async () => {
  const parseOwnerForecastSheetValues = await loadParser();
  const fields = [
    { column: 4, name: 'inflow' },
    { column: 2, name: 'outflow' },
    { column: 3, name: 'reserve' }
  ];

  for (const field of fields) {
    for (const value of [-1, '1', Number.NaN, Number.POSITIVE_INFINITY]) {
      const rows = liveRows();
      rows[5][field.column] = value;
      assert.throws(
        () => parseOwnerForecastSheetValues(rows),
        new RegExp(`dailyRows\\[0\\]\\.${field.name}.*${value === -1 ? 'non-negative' : 'finite'}`, 'i'),
        `${field.name}: ${String(value)}`
      );
    }
  }
});

test('normalizes negative zero in actual and daily monetary fields', async () => {
  const parseOwnerForecastSheetValues = await loadParser();
  const rows = liveRows();
  rows[2][1] = -0;
  rows[5][5] = -0;
  rows[5][4] = -0;
  rows[5][2] = -0;
  rows[5][3] = -0;

  const result = parseOwnerForecastSheetValues(rows);
  assert.equal(Object.is(result.availableCash, -0), false);
  assert.equal(Object.is(result.openingCash, -0), false);
  assert.equal(Object.is(result.flows[0].inflow, -0), false);
  assert.equal(Object.is(result.flows[0].outflow, -0), false);
  assert.equal(Object.is(result.protectedReserves[0].amount, -0), false);
});
