import test from 'node:test';
import assert from 'node:assert/strict';
import { syncCurrentDayTochkaDds } from '../lib/tochka-dds-import.js';

const HEADER = [
  'Месяц','Мсц (цифрой)','Дата','Сумма','Кошелек','Направление бизнеса',
  'Контрагент','Назначение платежа','Статья','Платеж/поступл','Вид д-ти',
  'Месяц P&L','Комментарий P&L','Ключ дубля','transactionId'
];
const rows = [1, 2].map(index => {
  const transactionId = `cbs-tb;artifact-${index};1`;
  const key = `40702810212500010112|${transactionId}`;
  return ['Сентябрь',9,46269,1000 * index,1,'','ООО "Банк Точка"','QR','Продажи','Поступление','Операционная',9,`Точка API | ${key}`,key,transactionId];
});

function mockSheets() {
  let leaseState = 'IDLE';
  let ddsComments = [];
  let journal = [];
  const calls = [];
  const shiftedArtifact = ['', '', '', '', '', '', 'Сентябрь', 9, 46269, -14000, 1, '', 'ООО "Банк Точка"', 'artifact'];
  const values = {
    batchGet: async () => ({ data: { valueRanges: [
      { values: [HEADER, ...rows] },
      { values: ddsComments },
      { values: journal },
      { values: [['Август'], ['Сентябрь']] }
    ] } }),
    get: async ({ range }) => {
      if (range.includes('__vercel_control')) return { data: { values: [['tochka_dds_import_lock', leaseState]] } };
      calls.push(['get', range]);
      if (range === "'ДДС: месяц'!A7:S8") return { data: { values: [shiftedArtifact, shiftedArtifact] } };
      if (range === "'ДДС: месяц'!A7:S2006") return { data: { values: [shiftedArtifact, shiftedArtifact] } };
      if (range === "'ДДС: месяц'!A9:S10") return { data: { values: [] } };
      if (range.includes("'ДДС: месяц'!M5:M30000")) return { data: { values: ddsComments } };
      if (range.includes("'Журнал Точка → ДДС'!A2:E3000")) return { data: { values: journal } };
      throw new Error(`Unexpected get range: ${range}`);
    },
    update: async payload => {
      calls.push(['update', payload.range]);
      assert.equal(payload.range, "'ДДС: месяц'!A9:M10");
      ddsComments = payload.requestBody.values.map(row => [row[12]]);
      return {};
    },
    append: async payload => {
      calls.push(['append', payload.range]);
      journal = payload.requestBody.values.map(row => [...row]);
      return {};
    }
  };
  return {
    calls,
    sheets: { spreadsheets: {
      values,
      get: async () => ({ data: { sheets: [{ properties: { sheetId: 17, title: '__vercel_control' } }] } }),
      batchUpdate: async ({ requestBody }) => {
        const op = requestBody.requests[0].findReplace;
        const changed = leaseState === op.find ? 1 : 0;
        if (changed) leaseState = op.replacement;
        return { data: { replies: [{ findReplace: { occurrencesChanged: changed } }] } };
      }
    } }
  };
}

test('skips a shifted G:S artifact block and writes to the next contiguous empty A:S rows', async () => {
  const mock = mockSheets();
  const result = await syncCurrentDayTochkaDds({
    sheets: mock.sheets,
    spreadsheetId: 'sheet-id',
    businessDate: '2026-09-04',
    now: () => new Date('2026-09-04T17:00:00.000Z')
  });

  assert.equal(result.verified, true);
  assert.equal(result.ddsAppended, 2);
  assert.equal(mock.calls.some(call => call[0] === 'get' && call[1] === "'ДДС: месяц'!A7:S2006"), true);
  assert.equal(mock.calls.some(call => call[0] === 'get' && call[1] === "'ДДС: месяц'!A9:S10"), true);
  assert.equal(mock.calls.some(call => call[0] === 'update' && call[1] === "'ДДС: месяц'!A9:M10"), true);
});