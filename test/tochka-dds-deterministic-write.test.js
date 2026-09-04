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

test('DDS writer targets an explicit A:M row instead of table-relative append', async () => {
  const calls = [];
  const ddsComments = [['old-1'], ['old-2'], ['comment-only']];
  const journal = [];
  const values = {
    batchGet: async ({ ranges }) => ({
      data: { valueRanges: ranges.map(range => {
        if (range.includes('API → ДДС готово')) return { values: [HEADER, ROW] };
        if (range.includes('ДДС: месяц') && range.includes('A5:A')) {
          return { values: [['Август'], ['Сентябрь'], []] };
        }
        if (range.includes('ДДС: месяц') && range.includes('M5:M')) {
          return { values: ddsComments };
        }
        if (range.includes('Журнал Точка → ДДС')) return { values: journal };
        throw new Error(`unexpected range ${range}`);
      }) }
    }),
    append: async payload => {
      calls.push(['append', payload.range]);
      if (payload.range.includes('ДДС: месяц')) ddsComments.push([ROW[12]]);
      if (payload.range.includes('Журнал Точка → ДДС')) journal.push(...payload.requestBody.values);
      return {};
    },
    update: async payload => {
      calls.push(['update', payload.range]);
      if (payload.range.includes('ДДС: месяц')) ddsComments.push([ROW[12]]);
      if (payload.range.includes('Журнал Точка → ДДС')) journal.push(...payload.requestBody.values);
      return {};
    },
    get: async ({ range }) => {
      if (range.includes('ДДС: месяц')) return { data: { values: ddsComments } };
      if (range.includes('Журнал Точка → ДДС')) return { data: { values: journal } };
      throw new Error(`unexpected get ${range}`);
    }
  };

  await syncCurrentDayTochkaDds({
    sheets: { spreadsheets: { values } },
    spreadsheetId: 'sheet-id',
    businessDate: '2026-09-04',
    now: () => new Date('2026-09-04T15:00:00.000Z')
  });

  assert.deepEqual(calls[0], ['update', "'ДДС: месяц'!A8:M8"]);
  assert.equal(calls.some(([method]) => method === 'append'), false);
  assert.deepEqual(calls[1], ['update', "'Журнал Точка → ДДС'!A2:E2"]);
});
