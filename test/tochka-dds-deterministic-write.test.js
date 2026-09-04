import test from 'node:test';
import assert from 'node:assert/strict';
import { syncCurrentDayTochkaDds } from '../lib/tochka-dds-import.js';

const HEADER = [
  'Месяц','Мсц (цифрой)','Дата','Сумма','Кошелек','Направление бизнеса',
  'Контрагент','Назначение платежа','Статья','Платеж/поступл','Вид д-ти',
  'Месяц P&L','Комментарий P&L','Ключ дубля','transactionId'
];
const KEY = '40702810212500010112|cbs-tb;2480513383;1';
const ROW = [
  'Сентябрь', 9, 46269, -6.8, 1, '', 'ООО "Банк Точка"', 'Комиссия',
  'РКО', 'Выбытие', 'Операционная', 9, `Точка API | ${KEY}`, KEY,
  'cbs-tb;2480513383;1'
];

test('DDS writer uses an exact empty A:M row after both canonical and shifted artifacts', async () => {
  const calls = [];
  const ddsComments = [];
  const journal = [];
  let leaseState = 'IDLE';
  const values = {
    batchGet: async () => ({
      data: { valueRanges: [
        { values: [HEADER, ROW] },
        { values: ddsComments },
        { values: journal }
      ] }
    }),
    append: async payload => {
      calls.push(['append', payload.range]);
      if (payload.range.includes('Журнал Точка → ДДС')) journal.push(...payload.requestBody.values);
      return {};
    },
    update: async payload => {
      calls.push(['update', payload.range]);
      if (payload.range.includes('ДДС: месяц')) ddsComments.push(...payload.requestBody.values.map(row => [row[12]]));
      return {};
    },
    get: async ({ range }) => {
      if (range.includes('__vercel_control')) {
        return { data: { values: [['tochka_dds_import_lock', leaseState]] } };
      }
      if (range.includes("'ДДС: месяц'!A5:A30000")) {
        return { data: { values: [['old'], ['old'], ['old']] } }; // last canonical row = 7
      }
      if (range.includes("'ДДС: месяц'!S5:S30000")) {
        return { data: { values: [[''], [''], [''], [''], ['shifted']] } }; // last shifted row = 9
      }
      if (range.includes("'ДДС: месяц'!M5:M30000")) return { data: { values: ddsComments } };
      if (range.includes('Журнал Точка → ДДС')) return { data: { values: journal } };
      throw new Error(`unexpected get ${range}`);
    }
  };
  const sheets = {
    spreadsheets: {
      values,
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

  await syncCurrentDayTochkaDds({
    sheets,
    spreadsheetId: 'sheet-id',
    businessDate: '2026-09-04',
    now: () => new Date('2026-09-04T15:00:00.000Z')
  });

  assert.deepEqual(calls[0], ['update', "'ДДС: месяц'!A10:M10"]);
  assert.deepEqual(calls[1], ['append', "'Журнал Точка → ДДС'!A:E"]);
  assert.equal(calls.some(([method, range]) => method === 'append' && range.includes('ДДС: месяц')), false);
  assert.equal(leaseState, 'IDLE');
});
