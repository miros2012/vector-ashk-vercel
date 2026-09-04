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
const KEY = '40702810212500010112|cbs-tb;2480513367;1';
const TRANSACTION_ID = 'cbs-tb;2480513367;1';
const ROW = [
  'Сентябрь',9,46269,1700,1,'','ООО "Банк Точка"','Зачисление по QR коду',
  'Продажи','Поступление','Операционная',9,`Точка API | ${KEY}`,KEY,TRANSACTION_ID
];

test('finds the row immediately after the last occupied anchor row', () => {
  assert.equal(findNextDdsRow([['Август'], [''], ['Сентябрь']], 5), 8);
  assert.equal(findNextDdsRow([], 5), 5);
});

test('writes DDS to an exact A:M range instead of values.append table detection', async () => {
  const calls = [];
  let ddsComments = [];
  let journal = [];
  const sheets = {
    spreadsheets: {
      values: {
        batchGet: async ({ ranges }) => {
          calls.push(['batchGet', ranges]);
          return { data: { valueRanges: [
            { values: [HEADER, ROW] },
            { values: ddsComments },
            { values: journal },
            { values: [['Август'], ['Сентябрь']] }
          ] } };
        },
        get: async ({ range }) => {
          calls.push(['get', range]);
          if (range === "'ДДС: месяц'!A7:S7") return { data: { values: [] } };
          if (range.includes("'ДДС: месяц'!M5:M30002")) return { data: { values: ddsComments } };
          if (range.includes("'Журнал Точка → ДДС'!A2:E3000")) return { data: { values: journal } };
          throw new Error(`Unexpected get range: ${range}`);
        },
        update: async payload => {
          calls.push(['update', payload.range, payload.requestBody.values]);
          assert.equal(payload.range, "'ДДС: месяц'!A7:M7");
          assert.equal(payload.requestBody.values[0].length, 13);
          ddsComments = [[`Точка API | ${KEY}`]];
          return {};
        },
        append: async payload => {
          calls.push(['append', payload.range, payload.requestBody.values]);
          assert.match(payload.range, /Журнал Точка → ДДС/);
          journal = payload.requestBody.values.map(row => [...row]);
          return {};
        }
      }
    }
  };

  const result = await syncCurrentDayTochkaDds({
    sheets,
    spreadsheetId: 'sheet-id',
    businessDate: BUSINESS_DATE,
    now: () => new Date('2026-09-04T15:00:00.000Z')
  });

  assert.equal(result.ddsAppended, 1);
  assert.equal(result.journalAppended, 1);
  assert.equal(calls.some(call => call[0] === 'append' && call[1].includes('ДДС: месяц')), false);
  assert.equal(calls.some(call => call[0] === 'update' && call[1] === "'ДДС: месяц'!A7:M7"), true);
});

test('fails closed before writing when the target A:S rows are not empty', async () => {
  let writes = 0;
  const sheets = {
    spreadsheets: {
      values: {
        batchGet: async () => ({ data: { valueRanges: [
          { values: [HEADER, ROW] },
          { values: [] },
          { values: [] },
          { values: [['Август'], ['Сентябрь']] }
        ] } }),
        get: async ({ range }) => {
          if (range === "'ДДС: месяц'!A7:S7") return { data: { values: [['','','','','','','occupied']] } };
          throw new Error(`Unexpected get range: ${range}`);
        },
        update: async () => { writes += 1; },
        append: async () => { writes += 1; }
      }
    }
  };

  await assert.rejects(() => syncCurrentDayTochkaDds({
    sheets,
    spreadsheetId: 'sheet-id',
    businessDate: BUSINESS_DATE,
    now: () => new Date('2026-09-04T15:00:00.000Z')
  }), /target rows are not empty/i);

  assert.equal(writes, 0);
});
