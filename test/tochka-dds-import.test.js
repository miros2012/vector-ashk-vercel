import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCurrentDayTochkaDdsPlan,
  createTochkaDdsImportHandler,
  syncCurrentDayTochkaDds
} from '../lib/tochka-dds-import.js';

const HEADER = [
  'Месяц','Мсц (цифрой)','Дата','Сумма','Кошелек','Направление бизнеса',
  'Контрагент','Назначение платежа','Статья','Платеж/поступл','Вид д-ти',
  'Месяц P&L','Комментарий P&L','Ключ дубля','transactionId'
];
const BUSINESS_DATE = '2026-09-04';
const BUSINESS_DATE_SERIAL = 46269;
const NOW = new Date('2026-09-04T15:00:00.000Z');
const K1 = '40702810212500010112|cbs-tb;2480375816;1';
const K2 = '40702810212500010112|cbs-tb;2480375884;1';

function readyRow({
  date = BUSINESS_DATE_SERIAL,
  amount = 5000,
  key = K1,
  transactionId = 'cbs-tb;2480375816;1',
  category = 'Продажи',
  flow = 'Поступление'
} = {}) {
  return [
    '2026-09', 9, date, amount, 112, '', 'ООО "Банк Точка"', 'QR операция',
    category, flow, 'Операционная', '2026-09', `Точка API | ${key}`, key, transactionId
  ];
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = Number(code); return this; },
    json(body) { this.body = body; return this; }
  };
}

function sheetsMock({ readyValues, ddsComments = [], journalValues = [], ddsReadbackFails = false } = {}) {
  const calls = [];
  const state = {
    ddsComments: ddsComments.map(row => [...row]),
    ddsAnchorValues: ddsComments.map(() => ['occupied']),
    journalValues: journalValues.map(row => [...row])
  };
  const sheets = {
    spreadsheets: {
      values: {
        batchGet: async ({ ranges }) => {
          calls.push(['batchGet', [...ranges]]);
          return {
            data: {
              valueRanges: [
                { values: readyValues.map(row => [...row]) },
                { values: state.ddsComments.map(row => [...row]) },
                { values: state.journalValues.map(row => [...row]) },
                { values: state.ddsAnchorValues.map(row => [...row]) }
              ]
            }
          };
        },
        update: async payload => {
          const values = payload.requestBody.values.map(row => [...row]);
          calls.push(['update', payload.range, values]);
          if (!payload.range.includes('ДДС: месяц')) {
            throw new Error(`Unexpected update range: ${payload.range}`);
          }
          state.ddsAnchorValues.push(...values.map(() => ['occupied']));
          if (!ddsReadbackFails) state.ddsComments.push(...values.map(row => [row[12]]));
          return {};
        },
        append: async payload => {
          const values = payload.requestBody.values.map(row => [...row]);
          calls.push(['append', payload.range, values]);
          if (payload.range.includes('Журнал Точка → ДДС')) {
            state.journalValues.push(...values);
          } else {
            throw new Error(`Unexpected append range: ${payload.range}`);
          }
          return {};
        },
        get: async ({ range }) => {
          calls.push(['get', range]);
          if (range.includes('ДДС: месяц') && /!A\d+:S\d+$/.test(range)) {
            return { data: { values: [] } };
          }
          if (range.includes('ДДС: месяц')) {
            return { data: { values: state.ddsComments.map(row => [...row]) } };
          }
          if (range.includes('Журнал Точка → ДДС')) {
            return { data: { values: state.journalValues.map(row => [...row]) } };
          }
          throw new Error(`Unexpected get range: ${range}`);
        }
      }
    }
  };
  return { sheets, calls, state };
}

test('plan imports only the current Tyumen business date and ignores malformed old backlog', () => {
  const oldMalformed = readyRow({
    date: BUSINESS_DATE_SERIAL - 1,
    amount: 'not-a-number',
    key: 'old-key',
    transactionId: 'old-transaction'
  });
  const currentDebit = readyRow({
    amount: -9.2,
    key: K2,
    transactionId: 'cbs-tb;2480375884;1',
    category: 'Банковские комиссии',
    flow: 'Выбытие'
  });

  const plan = buildCurrentDayTochkaDdsPlan({
    readyValues: [HEADER, oldMalformed, readyRow(), currentDebit],
    ddsCommentValues: [[`Точка API | ${K1}`]],
    journalValues: [],
    businessDate: BUSINESS_DATE,
    now: NOW
  });

  assert.deepEqual(plan.eligibleKeys, [K1, K2]);
  assert.equal(plan.ddsRows.length, 1);
  assert.deepEqual(plan.ddsRows[0], currentDebit.slice(0, 13));
  assert.equal(plan.journalRows.length, 2);
  assert.deepEqual(plan.journalRows[0], [
    K1,
    'cbs-tb;2480375816;1',
    '04.09.2026',
    '04.09.2026 20:00:00',
    'Импортировано'
  ]);
});

test('plan fails closed on a malformed or duplicate current-day ready row', () => {
  assert.throws(() => buildCurrentDayTochkaDdsPlan({
    readyValues: [HEADER, readyRow({ amount: 'not-a-number' })],
    ddsCommentValues: [],
    journalValues: [],
    businessDate: BUSINESS_DATE,
    now: NOW
  }), /current-day Tochka row/i);

  assert.throws(() => buildCurrentDayTochkaDdsPlan({
    readyValues: [HEADER, readyRow(), readyRow()],
    ddsCommentValues: [],
    journalValues: [],
    businessDate: BUSINESS_DATE,
    now: NOW
  }), /duplicate Tochka key/i);
});

test('sync writes DDS to an exact range, verifies it, then appends and verifies the journal', async () => {
  const debit = readyRow({
    amount: -9.2,
    key: K2,
    transactionId: 'cbs-tb;2480375884;1',
    category: 'Банковские комиссии',
    flow: 'Выбытие'
  });
  const { sheets, calls, state } = sheetsMock({
    readyValues: [HEADER, readyRow(), debit]
  });

  const result = await syncCurrentDayTochkaDds({
    sheets,
    spreadsheetId: 'sheet-id',
    businessDate: BUSINESS_DATE,
    now: () => NOW
  });

  assert.deepEqual(result, {
    ok: true,
    businessDate: BUSINESS_DATE,
    eligibleRows: 2,
    ddsAppended: 2,
    journalAppended: 2,
    verified: true
  });
  assert.deepEqual(calls.map(call => call[0]), [
    'batchGet', 'get', 'update', 'get', 'get', 'append', 'get'
  ]);
  assert.match(calls[1][1], /'ДДС: месяц'!A5:S6/);
  assert.match(calls[2][1], /'ДДС: месяц'!A5:M6/);
  assert.equal(calls[2][2][0].length, 13);
  assert.match(calls[5][1], /'Журнал Точка → ДДС'!A:E/);
  assert.equal(calls[5][2][0].length, 5);
  assert.equal(calls.filter(call => call[0] === 'append' && call[1].includes('ДДС: месяц')).length, 0);
  assert.deepEqual(state.ddsComments, [[`Точка API | ${K1}`], [`Точка API | ${K2}`]]);
  assert.deepEqual(state.journalValues.map(row => row[0]), [K1, K2]);
});

test('sync recovers after DDS was written but journal was not', async () => {
  const { sheets, calls, state } = sheetsMock({
    readyValues: [HEADER, readyRow()],
    ddsComments: [[`Точка API | ${K1}`]],
    journalValues: []
  });

  const result = await syncCurrentDayTochkaDds({
    sheets,
    spreadsheetId: 'sheet-id',
    businessDate: BUSINESS_DATE,
    now: () => NOW
  });

  assert.equal(result.ddsAppended, 0);
  assert.equal(result.journalAppended, 1);
  assert.equal(calls.filter(call => call[0] === 'update' && call[1].includes('ДДС: месяц')).length, 0);
  assert.deepEqual(state.journalValues.map(row => row[0]), [K1]);
});

test('sync never writes the journal when DDS readback does not contain the imported key', async () => {
  const { sheets, calls } = sheetsMock({
    readyValues: [HEADER, readyRow()],
    ddsReadbackFails: true
  });

  await assert.rejects(() => syncCurrentDayTochkaDds({
    sheets,
    spreadsheetId: 'sheet-id',
    businessDate: BUSINESS_DATE,
    now: () => NOW
  }), /DDS readback verification failed/i);

  assert.equal(calls.filter(call => call[0] === 'append' && call[1].includes('Журнал Точка → ДДС')).length, 0);
});

test('protected internal handler exposes aggregate counts only', async () => {
  let runs = 0;
  const handler = createTochkaDdsImportHandler({
    cronSecret: 'secret',
    runImport: async () => {
      runs += 1;
      return {
        ok: true,
        businessDate: BUSINESS_DATE,
        eligibleRows: 2,
        ddsAppended: 1,
        journalAppended: 2,
        verified: true,
        internalKeys: [K1, K2]
      };
    }
  });

  const denied = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer wrong' } }, denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(runs, 0);

  const allowed = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, allowed);
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(allowed.body, {
    ok: true,
    mode: 'tochka_dds_current_day',
    businessDate: BUSINESS_DATE,
    eligibleRows: 2,
    ddsAppended: 1,
    journalAppended: 2,
    verified: true
  });
  assert.equal(JSON.stringify(allowed.body).includes(K1), false);
});