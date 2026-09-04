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

test('DDS write is deterministic and anchored to an exact A:M target range', async () => {
  const calls = [];
  const ddsComments = [];
  const journal = [];
  let leaseState = 'IDLE';
  const values = {
    batchGet: async ({ ranges }) => {
      calls.push(['batchGet', ranges]);
      return {
        data: { valueRanges: [
          { values: [HEADER, ROW] },
          { values: ddsComments },
          { values: journal },
          { values: [] }
        ] }
      };
    },
    update: async payload => {
      calls.push(['update', payload.range]);
      assert.equal(payload.range, "'ДДС: месяц'!A5:M5");
      assert.equal(payload.valueInputOption, 'RAW');
      assert.deepEqual(payload.requestBody.values, [ROW.slice(0, 13)]);
      ddsComments.push([ROW[12]]);
      return {};
    },
    append: async payload => {
      calls.push(['append', payload.range]);
      assert.equal(payload.range, "'Журнал Точка → ДДС'!A:E");
      journal.push(...payload.requestBody.values);
      return {};
    },
    get: async ({ range }) => {
      if (range.includes('__vercel_control')) {
        return { data: { values: [['tochka_dds_import_lock', leaseState]] } };
      }
      calls.push(['get', range]);
      if (range === "'ДДС: месяц'!A5:S5") return { data: { values: [] } };
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

  assert.deepEqual(calls.map(call => call[0]), [
    'batchGet', 'get', 'update', 'get', 'get', 'append', 'get'
  ]);
  assert.equal(calls.some(call => call[0] === 'append' && call[1].includes('ДДС: месяц')), false);
  assert.equal(leaseState, 'IDLE');
});