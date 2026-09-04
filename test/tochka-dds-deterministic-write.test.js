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

test('DDS append is anchored to the canonical A:M table body', async () => {
  const calls = [];
  const ddsComments = [];
  const journal = [];
  let leaseState = 'IDLE';
  const values = {
    batchGet: async ({ ranges }) => ({
      data: { valueRanges: [
        { values: [HEADER, ROW] },
        { values: ddsComments },
        { values: journal }
      ] }
    }),
    append: async payload => {
      calls.push(['append', payload.range]);
      if (payload.range.includes('ДДС: месяц')) ddsComments.push([ROW[12]]);
      if (payload.range.includes('Журнал Точка → ДДС')) journal.push(...payload.requestBody.values);
      return {};
    },
    get: async ({ range }) => {
      if (range.includes('__vercel_control')) {
        return { data: { values: [['tochka_dds_import_lock', leaseState]] } };
      }
      if (range.includes('ДДС: месяц')) return { data: { values: ddsComments } };
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

  assert.deepEqual(calls[0], ['append', "'ДДС: месяц'!A5:M30000"]);
  assert.deepEqual(calls[1], ['append', "'Журнал Точка → ДДС'!A:E"]);
  assert.equal(leaseState, 'IDLE');
});
