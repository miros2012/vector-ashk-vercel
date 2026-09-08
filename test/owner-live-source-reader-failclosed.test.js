import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerLiveSourceReader } from '../lib/owner-live-source-reader.js';

const ranges = {
  dataHealth: "'Data Health Snapshot'!A1:L40",
  sales: "'РОП_Штаб_Утро'!A1:I500",
  receivables: "'АШК_Дебиторка_Свод__vercel'!A1:F2",
  obligations: "'Обязательства'!A1:Q500",
  adjustments: "'Корректировки обязательств'!A1:J500",
  drivingFund: "'Фонд вождения'!A21:J30",
  decisions: "'Решения'!A1:V200",
  history: "'История решений'!A1:K1000"
};

function forecastValues() {
  return [
    ['ПРОГНОЗ ДЕНЕГ — 30 ДНЕЙ', 'MVP v1', 'Горизонт', 1],
    ['Стартовый остаток', 100000],
    ['Дата', 'Остаток на начало', 'Поступления всего', 'Выплаты всего', 'Резерв / блокировка'],
    [46273, 100000, 1000, 500, 0]
  ];
}

function dataHealthValues() {
  return [
    ['Источник', 'Что проверяем', 'Последний маркер', 'Возраст, ч', 'WARN, ч', 'ERROR, ч', 'Статус'],
    ['Точка API', 'timestamp LIVE-остатков', '2026-09-07T10:00:00Z', 0.1, 2, 4, 'OK'],
    ['АШК оплаты', 'последняя успешная синхронизация', '2026-09-07T10:00:00Z', 0.1, 2, 26, 'OK'],
    ['АШК часы', 'LoadedAt текущего табеля', '2026-09-07T10:00:00Z', 0.1, 30, 54, 'OK'],
    ['АШК дебиторка / РОП', 'последняя успешная синхронизация', '2026-09-07T10:00:00Z', 0.1, 30, 54, 'OK'],
    ['Прогноз 30 дней', 'старт прогноза = завтра', '2026-09-08', 0, 1, 24, 'OK'],
    ['Точка операции', 'последний успешный refresh операций Точки', '2026-09-07T10:00:00Z', 0.1, 0.25, 2, 'OK'],
    ['Система', 'Общий статус', 'OK'],
    ['Точка → ДДС', 'внешних операций не дошло — сегодня + backlog', 0],
    ['Точка → ДДС', 'структура очереди — сегодня + backlog', 0, 'OK']
  ];
}

const sales = [
  ['Срез', 'Дата отчёта', 'Уровень', 'Менеджер', 'Филиал', 'План филиала на месяц', 'План филиала к дате', 'Факт филиала за день', 'Факт филиала с начала месяца'],
  ['СЕГОДНЯ — НА СЕЙЧАС', '2026-09-07', 'ГОРОД', '', 'Все филиалы', 1000000, 250000, 10000, 200000]
];

const obligationHeader = ['Дата','Обязательство','Категория','Сумма план (net)','Сумма факт','Остаток','Приоритет','Статус','Источник','Доверие','Ответственный','Комментарий','Регулярное','ID','Gross обязательство','Корректировки net','Net cash outflow'];
const adjustmentHeader = ['ID корректировки','ID обязательства','Тип корректировки','Направление','Сумма','Статус','Доверие','Источник','Комментарий','Дата оценки'];
const decisionHeader = ['Rule ID','Событие','Отклонение','Причина','Решение','Задача','Исполнитель','Дедлайн','Приоритет','Статус правила','Исполнение','Контроль','Денежный эффект / сумма риска','Фактический эффект','Источник','Связанный объект','Rank','Дата начала','Дата завершения','Результат исполнения','Верификация эффекта','Последняя проверка'];
const historyHeader = ['Event ID','Rule ID','Событие','Дата/время','Статус до','Статус после','Исполнитель','Плановый эффект / риск','Фактический эффект','Источник / доказательство','Комментарий'];

function baseMatrices() {
  return {
    [ranges.dataHealth]: dataHealthValues(),
    [ranges.sales]: sales,
    [ranges.receivables]: [['Тип','Объект','Договоров','Долг','Продажи','Оплачено'], ['ИТОГО','',1,1000,5000,4000]],
    [ranges.obligations]: [obligationHeader, [46273,'Лизинг','Лизинг',1000,0,1000,'Высокий','Прогноз','ДДС','Высокое','','','Да','OBL-1',1000,0,1000]],
    [ranges.adjustments]: [adjustmentHeader],
    [ranges.drivingFund]: [
      ['Необходимый резерв фонда, ₽','','','','','','','',1000],
      ['LIVE остаток фонда вождения, ₽','','','','','','','',500],
      ['Дефицит фонда (+) / избыток (-), ₽','','','','','','','',500]
    ],
    [ranges.decisions]: [decisionHeader, ['DEC-1','Событие','Отклонение','Причина','Решение','Задача','AI',46273,'Высокий','Активно','Не начато','Открыто',1000,'','Источник','',1,'','','','Не проверено','']],
    [ranges.history]: [historyHeader, ['EVT-1','DEC-1','Создано','2026-09-07T09:00:00Z','','Не начато','AI',1000,'','Decision Engine','']]
  };
}

function readerFor(mutate) {
  const matrices = baseMatrices();
  mutate?.(matrices);
  const sheets = {
    spreadsheets: {
      values: {
        async get() { return { data: { values: forecastValues() } }; },
        async batchGet({ ranges: requested }) {
          return { data: { valueRanges: requested.map(range => ({ range, values: matrices[range] })) } };
        }
      }
    }
  };
  return createOwnerLiveSourceReader({
    sheets,
    spreadsheetId: 'sheet-123',
    now: () => new Date('2026-09-07T10:00:00Z')
  });
}

test('rejects negative receivables monetary totals instead of exposing impossible owner facts', async () => {
  const reader = readerFor(matrices => {
    matrices[ranges.receivables][1][3] = -1;
  });
  await assert.rejects(() => reader.readOwnerLiveFacts(), /receivables debt.*non-negative/i);
});

test('rejects duplicate obligation and adjustment identifiers', async () => {
  const duplicateObligation = readerFor(matrices => {
    matrices[ranges.obligations].push([...matrices[ranges.obligations][1]]);
  });
  await assert.rejects(() => duplicateObligation.readOwnerLiveFacts(), /duplicate obligation id/i);

  const duplicateAdjustment = readerFor(matrices => {
    const row = ['ADJ-1','OBL-1','Корректировка','Уменьшение',100,'Учтено','Высокое','Источник','',46273];
    matrices[ranges.adjustments].push(row, [...row]);
  });
  await assert.rejects(() => duplicateAdjustment.readOwnerLiveFacts(), /duplicate obligation adjustment id/i);
});

test('rejects duplicate decision and history identifiers', async () => {
  const duplicateDecision = readerFor(matrices => {
    matrices[ranges.decisions].push([...matrices[ranges.decisions][1]]);
  });
  await assert.rejects(() => duplicateDecision.readOwnerLiveFacts(), /duplicate decision rule id/i);

  const duplicateHistory = readerFor(matrices => {
    matrices[ranges.history].push([...matrices[ranges.history][1]]);
  });
  await assert.rejects(() => duplicateHistory.readOwnerLiveFacts(), /duplicate decision history event id/i);
});
