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
    'РОП_Дебиторка_Приоритет': [
      ['№','Приоритет филиала','Филиал','Дефицит филиала','ДЗ филиала','StudentId','Курсант','Договор','Открыть в АШК','Менеджер АШК','Ответственный','Долг','Последняя оплата','Причина приоритета','Инструмент','Первое сообщение','Следующий шаг','Срок','Результат контакта','Обещанная сумма','Обещанная дата','Комментарий'],
      [1,'СЕГОДНЯ','Ямская',10000,50000,777,'Иванов Иван','A','https://app.dscontrol.ru/card/777','Менеджер','Менеджер',50000,'','Крупный долг','Звонок','Текст','Повтор','20:30','','','','']
    ]
  };
  const targetTasks = [
    source['РОП_Задачи_Сегодня'][0],
    ['2026-09-02','2026-09-01','СЕГОДНЯ','Ямская','Кравченко',1200000,100000,0,0,100000,0,460000,'Старая задача','2026-09-02 20:30','В РАБОТЕ','Позвонила, ждём оплату до 17:00']
  ];
  const targetDebtors = [
    source['РОП_Дебиторка_Приоритет'][0],
    [1,'СЕГОДНЯ','Ямская',9000,49000,777,'Иванов Иван','A','https://app.dscontrol.ru/card/777','Менеджер','Менеджер',49000,'','Крупный долг','Звонок','Текст','Повтор','20:30','ОБЕЩАНИЕ',15000,'2026-09-04','Оплатит после 17:00']
  ];
  const writes = [];
  const publish = createRopPublisher({
    targetSpreadsheetId: TARGET,
    readSheet: async (sheetName) => source[sheetName],
    readTargetSheet: async (spreadsheetId, sheetName) => {
      assert.equal(spreadsheetId, TARGET);
      if (sheetName === 'РОП_Задачи_Сегодня') return targetTasks;
      if (sheetName === 'РОП_Дебиторка_Приоритет') return targetDebtors;
      return [];
    },
    writeSheet: async (spreadsheetId, sheetName, values) => writes.push({ spreadsheetId, sheetName, values })
  });

  await publish();

  const taskWrite = writes.find(item => item.sheetName === 'РОП_Задачи_Сегодня');
  assert.ok(taskWrite);
  assert.equal(taskWrite.values[1][14], 'В РАБОТЕ');
  assert.equal(taskWrite.values[1][15], 'Позвонила, ждём оплату до 17:00');
  assert.equal(taskWrite.values[1][9], 105000, 'automatic deficit must still refresh from source');

  const debtorWrite = writes.find(item => item.sheetName === 'РОП_Дебиторка_Приоритет');
  assert.ok(debtorWrite);
  assert.equal(debtorWrite.values[1][11], 50000, 'automatic debt must still refresh from source');
  assert.equal(debtorWrite.values[1][18], 'ОБЕЩАНИЕ');
  assert.equal(debtorWrite.values[1][19], 15000);
  assert.equal(debtorWrite.values[1][20], '2026-09-04');
  assert.equal(debtorWrite.values[1][21], 'Оплатит после 17:00');
});
