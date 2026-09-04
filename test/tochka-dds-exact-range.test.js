import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findNextDdsRow,
  syncCurrentDayTochkaDds
} from '../lib/tochka-dds-import.js';

const HEADER = [
  'Месяц','Мсц (цифрой)','Дата','Сумма','Кошелек','Направление бизнеса',
  'Контрагент','Назначение платежа','Статья','Платеж/поступл','Вид д-ти',
  'Месяц P&L','Комментарий P&L','Ключ дубля','transactionId'
];
const BUSINESS_DATE = '2026-09-04';
const KEY = '40702810212500010112|cbs-tb;2480691936;1';
const TRANSACTION_ID = 'cbs-tb;2480691936;1';
const READY_ROW = [
  'Сентябрь',9,46269,13500,1,'','ООО "Банк Точка"','Зачисление по QR коду',
  'Продажи','Поступление','Операционная',9,`Точка API | ${KEY}`,KEY,TRANSACTION_ID
];

function leaseAwareSheets({ targetValues = [] } = {}) {
  const calls = [];
  let leaseState = 'IDLE';
  let ddsComments = [];
  let journalValues = [];

  const sheets = {
    spreadsheets: {
      values: {
        get: async ({ range }) => {
          if (range.includes('__vercel_control')) {
            return { data: { values: [['tochka_dds_import_lock', leaseState]] } };
          }
          calls.push(['get', range]);
          if (range === "'ДДС: месяц'!A7:S7") {
            return { data: { values: targetValues.map(row => [...row]) } };
          }
          if (range.includes("'ДДС: месяц'!M5:M30000")) {
            return { data: { values: ddsComments.map(row => [...row]) } };
          }
          if (range.includes("'Журнал Точка → ДДС'!A2:E3000")) {
            return { data: { values: journalValues.map(row => [...row]) } };
          }
          throw new Error(`Unexpected get range: ${range}`);
        },
        batchGet: async ({ ranges }) => {
          calls.push(['batchGet', [...ranges]]);
          return { data: { valueRanges: [
            { values: [HEADER, READY_ROW] },
            { values: ddsComments.map(row => [...row]) },
            { values: journalValues.map(row => [...row]) },
            { values: [['Август'], ['Сентябрь']] }
          ] } };
        },
        update: async payload => {
          const values = payload.requestBody.values.map(row => [...row]);
          calls.push(['update', payload.range, values]);
          assert.equal(payload.range, "'ДДС: месяц'!A7:M7");
          assert.equal(payload.valueInputOption, 'RAW');
          assert.equal(values[0].length, 13);
          ddsComments = [[`Точка API | ${KEY}`]];
          return {};
        },
        append: async payload => {
          const values = payload.requestBody.values.map(row => [...row]);
          calls.push(['append', payload.range, values]);
          assert.match(payload.range, /Журнал Точка → ДДС/);
          journalValues = values;
          return {};
        }
      },
      get: async () => ({
        data: { sheets: [{ properties: { sheetId: 17, title: '__vercel_control' } }] }
      }),
      batchUpdate: async ({ requestBody }) => {
        const operation = requestBody.requests[0].findReplace;
        const changed = leaseState === operation.find ? 1 : 0;
        if (changed) leaseState = operation.replacement;
        return { data: { replies: [{ findReplace: { occurrencesChanged: changed } }] } };
      }
    }
  };

  return {
    sheets,
    calls,
    get leaseState() { return leaseState; },
    get journalValues() { return journalValues; }
  };
}

test('finds the first safe DDS row after the last occupied anchor row', () => {
  assert.equal(findNextDdsRow([['Август'], [''], ['Сентябрь']], 5), 8);
  assert.equal(findNextDdsRow([], 5), 5);
});

test('writes current-day DDS rows to an exact A:M range and never appends to DDS', async () => {
  const mock = leaseAwareSheets();

  const result = await syncCurrentDayTochkaDds({
    sheets: mock.sheets,
    spreadsheetId: 'sheet-id',
    businessDate: BUSINESS_DATE,
    now: () => new Date('2026-09-04T15:00:00.000Z')
  });

  assert.equal(result.ddsAppended, 1);
  assert.equal(result.journalAppended, 1);
  assert.equal(mock.calls.some(call => call[0] === 'get' && call[1] === "'ДДС: месяц'!A7:S7"), true);
  assert.equal(mock.calls.some(call => call[0] === 'update' && call[1] === "'ДДС: месяц'!A7:M7"), true);
  assert.equal(mock.calls.some(call => call[0] === 'append' && call[1].includes('ДДС: месяц')), false);
  assert.equal(mock.journalValues[0][0], KEY);
  assert.equal(mock.leaseState, 'IDLE');
});

test('fails closed and releases the import lease when target A:S is occupied', async () => {
  const mock = leaseAwareSheets({ targetValues: [['','','','','','','occupied']] });

  await assert.rejects(() => syncCurrentDayTochkaDds({
    sheets: mock.sheets,
    spreadsheetId: 'sheet-id',
    businessDate: BUSINESS_DATE,
    now: () => new Date('2026-09-04T15:00:00.000Z')
  }), /target rows are not empty/i);

  assert.equal(mock.calls.some(call => call[0] === 'update'), false);
  assert.equal(mock.calls.some(call => call[0] === 'append'), false);
  assert.equal(mock.leaseState, 'IDLE');
});