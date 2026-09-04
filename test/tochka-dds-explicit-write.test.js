import test from 'node:test';
import assert from 'node:assert/strict';
import { syncCurrentDayTochkaDds } from '../lib/tochka-dds-import.js';

const HEADER = [
  'Месяц','Мсц (цифрой)','Дата','Сумма','Кошелек','Направление бизнеса',
  'Контрагент','Назначение платежа','Статья','Платеж/поступл','Вид д-ти',
  'Месяц P&L','Комментарий P&L','Ключ дубля','transactionId'
];
const KEY = '40702810212500010112|cbs-tb;shift-repro;1';
const READY = [
  HEADER,
  ['Сентябрь', 9, 46269, 5000, 1, '', 'ООО "Банк Точка"', 'QR операция', 'Продажи', 'Поступление', 'Операционная', 9, `Точка API | ${KEY}`, KEY, 'cbs-tb;shift-repro;1']
];

function sheetsMock() {
  let leaseState = 'IDLE';
  const calls = [];
  const ddsRows = [
    ['Сентябрь', 9, 46268, 1000, 1, '', 'Контрагент', 'Назначение', 'Продажи', 'Поступление', 'Операционная', 9, 'Точка API | existing-key'],
    ['', '', '', '', '', '', 'Сентябрь', 9, 46269, -14000, 1, '', 'ООО "Банк Точка"', 'shifted artifact', 'Продажи', 'Выбытие', 'Операционная', 9, 'Точка API | shifted-key']
  ];
  const journal = [];

  const values = {
    batchGet: async ({ ranges }) => {
      calls.push(['batchGet', [...ranges]]);
      return { data: { valueRanges: [
        { values: READY.map(row => [...row]) },
        { values: ddsRows.map(row => [row[12]]).filter(row => row[0]) },
        { values: journal.map(row => [...row]) }
      ] } };
    },
    append: async payload => {
      calls.push(['append', payload.range]);
      if (payload.range.includes('ДДС: месяц')) {
        // Reproduce the production failure: values.append infers the active table
        // from the shifted G:S artifact and writes the new A:M payload into G:S.
        ddsRows.push(['', '', '', '', '', '', ...payload.requestBody.values[0]]);
        return {};
      }
      if (payload.range.includes('Журнал Точка → ДДС')) {
        journal.push(...payload.requestBody.values.map(row => [...row]));
        return {};
      }
      throw new Error(`Unexpected append range: ${payload.range}`);
    },
    update: async payload => {
      calls.push(['update', payload.range, payload.requestBody.values.map(row => [...row])]);
      ddsRows.push(...payload.requestBody.values.map(row => [...row]));
      return {};
    },
    get: async ({ range }) => {
      if (range.includes('__vercel_control')) {
        return { data: { values: [['tochka_dds_import_lock', leaseState]] } };
      }
      calls.push(['get', range]);
      if (range.includes("'ДДС: месяц'!A5:S30000")) return { data: { values: ddsRows.map(row => [...row]) } };
      if (range.includes("'ДДС: месяц'!M5:M30000")) return { data: { values: ddsRows.map(row => [row[12]]).filter(row => row[0]) } };
      if (range.includes('Журнал Точка → ДДС')) return { data: { values: journal.map(row => [...row]) } };
      throw new Error(`Unexpected get range: ${range}`);
    }
  };

  const sheets = {
    spreadsheets: {
      values,
      get: async () => ({ data: { sheets: [{ properties: { sheetId: 17, title: '__vercel_control' } }] } }),
      batchUpdate: async ({ requestBody }) => {
        const op = requestBody.requests[0].findReplace;
        const changed = leaseState === op.find ? 1 : 0;
        if (changed) leaseState = op.replacement;
        return { data: { replies: [{ findReplace: { occurrencesChanged: changed } }] };
      }
    }
  };
  return { sheets, calls };
}

test('DDS writer uses an explicit A:M update after the last occupied A:S row', async () => {
  const mock = sheetsMock();
  const result = await syncCurrentDayTochkaDds({
    sheets: mock.sheets,
    spreadsheetId: 'sheet-id',
    businessDate: '2026-09-04',
    now: () => new Date('2026-09-04T17:00:00.000Z')
  });

  assert.equal(result.verified, true);
  assert.equal(result.ddsAppended, 1);
  assert.equal(mock.calls.some(call => call[0] === 'append' && call[1].includes('ДДС: месяц')), false);
  const bodyReadIndex = mock.calls.findIndex(call => call[0] === 'get' && call[1].includes("'ДДС: месяц'!A5:S30000"));
  const writeIndex = mock.calls.findIndex(call => call[0] === 'update');
  assert.ok(bodyReadIndex >= 0, 'expected bounded A:S occupancy read');
  assert.ok(writeIndex > bodyReadIndex, 'explicit DDS write must follow occupancy read');
  const write = mock.calls[writeIndex];
  assert.equal(write[1], "'ДДС: месяц'!A7:M7");
  assert.equal(write[2][0][12], `Точка API | ${KEY}`);
});
