import test from 'node:test';
import assert from 'node:assert/strict';
import { createRopPublisher } from '../lib/rop-publisher.js';

const TARGET = 'target-sheet';

test('ROP publisher preserves manual task status and note by task date plus branch', async () => {
  const source = {
    'РОП_Штаб_Утро': [['Срез'], ['x']],
    'РОП_Задачи_Сегодня': [
      ['Дата задачи','Дата отчёта','Приоритет','Филиал','Ответственные','План месяца','План к дате','Факт вчера','Факт с начала месяца','Дефицит, ₽','Прогноз месяца','Текущая ДЗ','Задача','Срок','Статус исполнения','Примечание'],
      ['2026-09-02','2026-09-02','СЕГОДНЯ','Ямская','Кравченко',1200000,105000,0,0,105000,0,460000,'Добрать','2026-09-02 20:30','К РАБОТЕ','generated note']
    ],
    'РОП_Контроль_Дня': [['Дата'], ['x']],
    'РОП_План_Сентябрь': [['Менеджер'], ['x']],
    'РОП_Дебиторка_Приоритет': [['№'], [1]]
  };
  const targetTasks = [
    source['РОП_Задачи_Сегодня'][0],
    ['2026-09-02','2026-09-01','СЕГОДНЯ','Ямская','Кравченко',1200000,100000,0,0,100000,0,460000,'Старая задача','2026-09-02 20:30','В РАБОТЕ','Позвонила, ждём оплату до 17:00']
  ];
  const writes = [];
  const publish = createRopPublisher({
    targetSpreadsheetId: TARGET,
    readSheet: async (sheetName) => source[sheetName],
    readTargetSheet: async (spreadsheetId, sheetName) => {
      assert.equal(spreadsheetId, TARGET);
      return sheetName === 'РОП_Задачи_Сегодня' ? targetTasks : [];
    },
    writeSheet: async (spreadsheetId, sheetName, values) => writes.push({ spreadsheetId, sheetName, values })
  });

  await publish();

  const taskWrite = writes.find(item => item.sheetName === 'РОП_Задачи_Сегодня');
  assert.ok(taskWrite);
  assert.equal(taskWrite.values[1][14], 'В РАБОТЕ');
  assert.equal(taskWrite.values[1][15], 'Позвонила, ждём оплату до 17:00');
  assert.equal(taskWrite.values[1][9], 105000, 'automatic deficit must still refresh from source');
});
