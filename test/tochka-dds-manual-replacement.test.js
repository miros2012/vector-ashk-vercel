import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCurrentDayTochkaDdsPlan, syncCurrentDayTochkaDds } from '../lib/tochka-dds-import.js';

const key = '40700000000000000001|cbs-tb;test-split;1';
const header = ['Месяц','Мсц (цифрой)','Дата','Сумма','Кошелек','Направление бизнеса','Контрагент','Назначение платежа','Статья','Платеж/поступл','Вид д-ти','Месяц P&L','Комментарий P&L','Ключ дубля','transactionId'];
const controlHeader = ['Дата операции','Фонд','Счёт','Тип движения','Сумма со знаком','Контрагент','ИНН','Назначение платежа','Тип операции','transactionId','Ключ дубля','Статус интеграции','Статья ДДС авто','Вид д-ти','Месяц P&L','Готовность'];
const ready = ['Сентябрь',9,'21.09.2026',-300,1,'','Example','Salary','Зарплата админ персонала','Выбытие','Операционная',9,`Точка API | ${key}`,key,'cbs-tb;test-split;1'];
const evidence = { rows: [10, 11], amount: -300, date: '2026-09-21', wallet: 1, reason: 'Owner-approved split' };
const replacement = amount => ['Сентябрь',9,'21.09.2026',amount,1,'','Example','Salary','Зарплата админ персонала','Выбытие','Операционная',9,'Manual allocation'];
function input(overrides = {}) {
  return {
    readyValues: [header],
    controlValues: [controlHeader, ['21.09.2026','Общий',1,'Расход',-300,'Example','','Salary','Payment','cbs-tb;test-split;1',key,'К импорту','Зарплата админ персонала','Операционная',9,'Импортировано ранее']],
    journalValues: [[key,'cbs-tb;test-split;1','21.09.2026','22.09.2026',`Учтено вручную | ${JSON.stringify(evidence)}`]],
    replacementDdsRows: { 10: replacement(-100), 11: replacement(-200) },
    ddsCommentValues: [], businessDate: '2026-09-22', ...overrides
  };
}

test('does not resurrect an owner-approved split from imported historical control rows', () => {
  const plan = buildCurrentDayTochkaDdsPlan(input());
  assert.deepEqual(plan.ddsRows, []);
  assert.deepEqual(plan.journalRows, []);
});

test('manual replacement also overrides ready/current-day candidates', () => {
  const plan = buildCurrentDayTochkaDdsPlan(input({ readyValues: [header,ready], controlValues: [], businessDate: '2026-09-21' }));
  assert.deepEqual(plan.ddsRows, []);
});

test('missing or changed replacement evidence blocks import instead of hiding lost accounting', () => {
  for (const replacementDdsRows of [{}, {10: replacement(-100),11: replacement(-199)}, {10: replacement(-100),11: [...replacement(-200)].map((v,i)=>i===4?2:v)}]) {
    assert.throws(() => buildCurrentDayTochkaDdsPlan(input({replacementDdsRows})), /replacement/i);
  }
});

test('an original imported row alongside manual replacements is reported as a conflict', () => {
  assert.throws(() => buildCurrentDayTochkaDdsPlan(input({ddsCommentValues: [[`Точка API | ${key}`]]})), /replacement/i);
});

test('plain imported journal entries still recover genuinely missing DDS rows', () => {
  const plan = buildCurrentDayTochkaDdsPlan(input({journalValues: [[key,'cbs-tb;test-split;1','','','Импортировано']]}));
  assert.equal(plan.ddsRows.length,1);
  assert.equal(plan.ddsRows[0][3],-300);
});

test('owner notes before or after a bank key do not make its DDS row disappear', () => {
  for (const comment of [`Точка API | ${key} | owner confirmed`, `Owner confirmed | Точка API | ${key}`]) {
    const plan = buildCurrentDayTochkaDdsPlan(input({
      journalValues: [[key,'cbs-tb;test-split;1','','','Импортировано']],
      ddsCommentValues: [[comment]]
    }));
    assert.deepEqual(plan.ddsRows, []);
  }
});

test('approved split may retain its canonical bank key on each allocation', () => {
  const a = replacement(-100), b = replacement(-200);
  a[12] = `Точка API | ${key} | first allocation`;
  b[12] = `Точка API | ${key} | second allocation`;
  assert.deepEqual(buildCurrentDayTochkaDdsPlan(input({
    replacementDdsRows:{10:a,11:b}, ddsCommentValues:[[a[12]],[b[12]]]
  })).ddsRows, []);
});

test('malformed or duplicated manual dispositions fail closed', () => {
  const value = input();
  for (const journalValues of [[...value.journalValues,...value.journalValues],[[key,'cbs-tb;test-split;1','','','Учтено вручную | invalid']]]) {
    assert.throws(() => buildCurrentDayTochkaDdsPlan(input({journalValues})), /replacement/i);
  }
});

test('runtime reads persisted replacements and remains a no-op on repeated runs', async () => {
  let lease = 'IDLE';
  let writes = 0;
  const data = input();
  const sheets = {spreadsheets: {
    get: async () => ({data:{sheets:[{properties:{sheetId:17,title:'__vercel_control'}}]}}),
    batchUpdate: async ({requestBody}) => { const op=requestBody.requests[0].findReplace; const changed=lease===op.find?1:0; if(changed)lease=op.replacement; return {data:{replies:[{findReplace:{occurrencesChanged:changed}}]}}; },
    values: {
      get: async ({range}) => { assert.match(range,/__vercel_control/); return {data:{values:[['tochka_dds_import_lock',lease]]}}; },
      batchGet: async ({ranges}) => ({data:{valueRanges:ranges.map(range => {
        if(range==="'API → ДДС готово'!A1:O3000")return {values:data.readyValues};
        if(range==="'Контроль Точка → ДДС'!A4:P3000")return {values:data.controlValues};
        if(range==="'Журнал Точка → ДДС'!A2:E3000")return {values:data.journalValues};
        if(range==="'ДДС: месяц'!M5:M30000")return {values:[]};
        if(range==="'ДДС: месяц'!A5:A30000")return {values:[['Сентябрь']]};
        if(range==="'ДДС: месяц'!A10:M10")return {values:[replacement(-100)]};
        if(range==="'ДДС: месяц'!A11:M11")return {values:[replacement(-200)]};
        throw Error(`Unexpected range ${range}`);
      })}}),
      update: async () => {writes++; throw Error('unexpected DDS mutation');},
      append: async () => {writes++; throw Error('unexpected journal mutation');}
    }
  }};
  for(let i=0;i<2;i++) {
    const result=await syncCurrentDayTochkaDds({sheets,spreadsheetId:'test',businessDate:'2026-09-22'});
    assert.equal(result.verified,true);
    assert.equal(result.ddsAppended,0);
  }
  assert.equal(writes,0);
});
