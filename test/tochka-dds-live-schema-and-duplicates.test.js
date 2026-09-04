import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCurrentDayTochkaDdsPlan,
  syncCurrentDayTochkaDds
} from '../lib/tochka-dds-import.js';

const BUSINESS_DATE = '2026-09-04';
const BUSINESS_DATE_SERIAL = 46269;
const NOW = new Date('2026-09-04T15:00:00.000Z');
const KEY = '40702810212500010112|cbs-tb;2480375816;1';
const TRANSACTION_ID = 'cbs-tb;2480375816;1';

const LIVE_HEADER = [
  'Месяц','Мсц (цифрой)','Дата','Сумма','Кошелек','Направление бизнеса',
  'Контрагент','Назначение платежа','Статья','Платеж/поступл','Вид д-ти',
  'Месяц P&L','Комментарий P&L','Ключ дубля','transactionId'
];

function readyRow() {
  return [
    'Сентябрь', 9, BUSINESS_DATE_SERIAL, 5000, 1, '', 'ООО "Банк Точка"',
    'Зачисление по QR коду', 'Продажи', 'Поступление', 'Операционная', 9,
    `Точка API | ${KEY}`, KEY, TRANSACTION_ID
  ];
}

function sheetsMock({ ddsCount = 1, journalCount = 1 } = {}) {
  const calls = [];
  let leaseState = 'IDLE';
  const dds = Array.from({ length: ddsCount }, () => [`Точка API | ${KEY}`]);
  const journal = Array.from({ length: journalCount }, () => [
    KEY, TRANSACTION_ID, '04.09.2026', '04.09.2026 20:00:00', 'Импортировано'
  ]);
  const sheets = {
    spreadsheets: {
      values: {
        batchGet: async () => ({
          data: {
            valueRanges: [
              { values: [LIVE_HEADER, readyRow()] },
              { values: dds.map(row => [...row]) },
              { values: journal.map(row => [...row]) }
            ]
          }
        }),
        append: async payload => {
          calls.push(['append', payload.range]);
          return {};
        },
        get: async ({ range }) => {
          if (range.includes('__vercel_control')) {
            return { data: { values: [['tochka_dds_import_lock', leaseState]] } };
          }
          calls.push(['get', range]);
          if (range.includes('ДДС: месяц')) return { data: { values: dds.map(row => [...row]) } };
          if (range.includes('Журнал Точка → ДДС')) return { data: { values: journal.map(row => [...row]) } };
          throw new Error(`Unexpected range: ${range}`);
        }
      },
      get: async () => ({
        data: { sheets: [{ properties: { sheetId: 17, title: '__vercel_control' } }] }
      }),
      batchUpdate: async ({ requestBody }) => {
        const op = requestBody.requests[0].findReplace;
        const changed = leaseState === op.find ? 1 : 0;
        if (changed) leaseState = op.replacement;
        return { data: { replies: [{ findReplace: { occurrencesChanged: changed } }] } };
      }
    }
  };
  return { sheets, calls, get leaseState() { return leaseState; } };
}

test('accepts the exact live API → DDS ready sheet header', () => {
  const plan = buildCurrentDayTochkaDdsPlan({
    readyValues: [LIVE_HEADER, readyRow()],
    ddsCommentValues: [],
    journalValues: [],
    businessDate: BUSINESS_DATE,
    now: NOW
  });

  assert.deepEqual(plan.eligibleKeys, [KEY]);
  assert.equal(plan.ddsRows.length, 1);
  assert.equal(plan.journalRows.length, 1);
});

test('fails closed when an eligible key already exists more than once in DDS', async () => {
  const mock = sheetsMock({ ddsCount: 2, journalCount: 1 });

  await assert.rejects(() => syncCurrentDayTochkaDds({
    sheets: mock.sheets,
    spreadsheetId: 'sheet-id',
    businessDate: BUSINESS_DATE,
    now: () => NOW
  }), /DDS readback verification failed/i);

  assert.equal(mock.calls.some(call => call[0] === 'append'), false);
  assert.equal(mock.leaseState, 'IDLE');
});

test('fails closed when an eligible key already exists more than once in the journal', async () => {
  const mock = sheetsMock({ ddsCount: 1, journalCount: 2 });

  await assert.rejects(() => syncCurrentDayTochkaDds({
    sheets: mock.sheets,
    spreadsheetId: 'sheet-id',
    businessDate: BUSINESS_DATE,
    now: () => NOW
  }), /Journal readback verification failed/i);

  assert.equal(mock.calls.some(call => call[0] === 'append'), false);
  assert.equal(mock.leaseState, 'IDLE');
});

test('verified no-op succeeds when the eligible key exists exactly once in DDS and journal', async () => {
  const mock = sheetsMock({ ddsCount: 1, journalCount: 1 });

  const result = await syncCurrentDayTochkaDds({
    sheets: mock.sheets,
    spreadsheetId: 'sheet-id',
    businessDate: BUSINESS_DATE,
    now: () => NOW
  });

  assert.deepEqual(result, {
    ok: true,
    businessDate: BUSINESS_DATE,
    eligibleRows: 1,
    ddsAppended: 0,
    journalAppended: 0,
    verified: true
  });
  assert.equal(mock.calls.some(call => call[0] === 'append'), false);
  assert.equal(mock.leaseState, 'IDLE');
});
