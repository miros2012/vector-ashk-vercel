import test from 'node:test';
import assert from 'node:assert/strict';

async function loadReader() {
  try {
    const module = await import('../lib/owner-live-source-reader.js');
    return module.createOwnerLiveSourceReader;
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined;
    throw error;
  }
}

const RANGES = Object.freeze({
  dataHealth: "'Data Health Snapshot'!A1:L40",
  sales: "'РОП_Штаб_Утро'!A1:I500",
  receivables: "'АШК_Дебиторка_Свод__vercel'!A1:F2",
  obligations: "'Обязательства'!A1:Q500",
  adjustments: "'Корректировки обязательств'!A1:J500",
  drivingFund: "'Фонд вождения'!A21:J30",
  decisions: "'Решения'!A1:V200",
  history: "'История решений'!A1:K1000"
});

function forecastValues() {
  return [
    ['ПРОГНОЗ ДЕНЕГ — 30 ДНЕЙ', 'MVP v1', 'Горизонт', 2],
    ['Стартовый остаток', 144084],
    ['Дата', 'Остаток на начало', 'Поступления всего', 'Выплаты всего', 'Резерв / блокировка'],
    [46273, -138216.02, 275931.40275, 92718, 16831.81556775],
    [46274, 44997.38275, 245667.79575, 0, 31817.5511085]
  ];
}

function dataHealthValues() {
  return [
    ['Источник', 'Что проверяем', 'Последний маркер', 'Возраст, ч', 'WARN, ч', 'ERROR, ч', 'Статус'],
    ['Точка API', 'timestamp LIVE-остатков', '2026-09-07T10:00:00Z', 0.1, 2, 4, 'OK'],
    ['АШК оплаты', 'последняя успешная синхронизация', '2026-09-07T10:00:00Z', 0.1, 2, 26, 'OK'],
    ['АШК часы', 'LoadedAt текущего табеля', '2026-09-07T00:00:00Z', 10, 30, 54, 'OK'],
    ['АШК дебиторка / РОП', 'последняя успешная синхронизация', '2026-09-07T00:00:00Z', 10, 30, 54, 'OK'],
    ['Прогноз 30 дней', 'старт прогноза = завтра', '2026-09-08', 0, 1, 24, 'OK'],
    ['Точка операции', 'последний успешный refresh операций Точки', '2026-09-07T10:00:00Z', 0.1, 0.25, 2, 'OK'],
    ['Банк', 'Рабочий баланс, ₽', 214102.8],
    ['Обязательства', 'Неподтверждённых', 0],
    ['Прогноз', 'Кассовый разрыв 30 дней, ₽', 0],
    ['Продажи', 'РОП — дефицит к плану на дату, ₽', 919831.94],
    ['Дебиторка', 'Текущая дебиторка, ₽', 3202805],
    ['Фонд вождения', 'Дефицит фонда, ₽', 2514673.07],
    ['Система', 'Общий статус', 'RISK'],
    ['Точка → ДДС', 'внешних операций не дошло — сегодня + backlog', 2],
    ['Точка → ДДС', 'структура очереди — сегодня + backlog', 2, 'OK']
  ];
}

function salesValues({ duplicateCity = false } = {}) {
  const rows = [
    ['Срез', 'Дата отчёта', 'Уровень', 'Менеджер', 'Филиал', 'План филиала на месяц', 'План филиала к дате', 'Факт филиала за день', 'Факт филиала с начала месяца'],
    ['ВЧЕРА — ЗАКРЫТО', '2026-09-06', 'ГОРОД', '', 'Все филиалы', 10560000, 1968492.84, 40100, 1376894],
    ['СЕГОДНЯ — НА СЕЙЧАС', '2026-09-07', 'ГОРОД', '', 'Все филиалы', 10560000, 2439725.94, 143000, 1519894]
  ];
  if (duplicateCity) rows.push([...rows[2]]);
  return rows;
}

function receivablesValues({ includeTotal = true } = {}) {
  const rows = [['Тип', 'Объект', 'Договоров', 'Долг', 'Продажи', 'Оплачено']];
  if (includeTotal) rows.push(['ИТОГО', '', 177, 3202805, 6315867, 3113062]);
  else rows.push(['МЕНЕДЖЕР', 'Кузнецова Марина', 31, 573510, 994220, 420710]);
  return rows;
}

function obligationValues({ missingUnconfirmedAmount = false } = {}) {
  return [
    ['Дата','Обязательство','Категория','Сумма план (net)','Сумма факт','Остаток','Приоритет','Статус','Источник','Доверие','Ответственный','Комментарий','Регулярное','ID','Gross обязательство','Корректировки net','Net cash outflow'],
    [46270, 'Закрытое обязательство', 'Зарплата', 1000, 1000, 0, 'Критический', 'Оплачено', 'ДДС', 'Высокое', '', '', 'Да', 'PAID-1', 1000, 0, 0],
    [46271, 'Лизинг', 'Кредиты / лизинг', 192403.74, 0, 192403.74, 'Высокий', 'Прогноз', 'История ДДС', 'Среднее', '', '', 'Да', 'LEASE-1', 192403.74, 0, 192403.74],
    [46272, 'Неуточнённое', 'Прочее', 500, 0, 500, 'Высокий', 'Требует подтверждения', 'Ручной источник', 'Низкое', '', '', 'Нет', 'REVIEW-1', 500, 0, missingUnconfirmedAmount ? '' : 500]
  ];
}

function adjustmentValues() {
  return [
    ['ID корректировки','ID обязательства','Тип корректировки','Направление','Сумма','Статус','Доверие','Источник','Комментарий','Дата оценки'],
    ['ADJ-1','PAID-1','Подтвержденные выплаты / удержания','Уменьшение',529782.22,'Исключено','Высокое','Исторический verified payroll','Не применять повторно',46267]
  ];
}

function drivingFundValues() {
  return [
    ['УПРОЩЕННАЯ МОДЕЛЬ ФОНДА — принято 04.09.2026'],
    ['Основной час, ₽', '', '', '', '', '', '', '', 460],
    ['Дополнительный час, ₽', '', '', '', '', '', '', '', 595],
    ['Средневзвешенный час, ₽', '', '', '', '', '', '', '', 493.17874892887744],
    ['Накопленное обязательство, часов', '', '', '', '', '', '', '', 5284],
    ['Необходимый резерв фонда, ₽', '', '', '', '', '', '', '', 2605956.5093401885],
    ['LIVE остаток фонда вождения, ₽', '', '', '', '', '', '', '', 91283.44],
    ['Дефицит фонда (+) / избыток (-), ₽', '', '', '', '', '', '', '', 2514673.0693401885]
  ];
}

function decisionValues() {
  return [
    ['Rule ID','Событие','Отклонение','Причина','Решение','Задача','Исполнитель','Дедлайн','Приоритет','Статус правила','Исполнение','Контроль','Денежный эффект / сумма риска','Фактический эффект','Источник','Связанный объект','Rank','Дата начала','Дата завершения','Результат исполнения','Верификация эффекта','Последняя проверка'],
    ['DEC-CASH-GAP','Прогноз денежных средств','Кассовый разрыв','Причина','Решение','Задача','Собственник',46271,'Критический','Активно','Не начато','Открыто',613941.1775,'','Прогноз 30 дней','',1,'','','','Не проверено',''],
    ['DEC-SYNTH-SMOKE','Synthetic','','','','','AI',46271,'Низкий','Активно','Готово','Закрыто',1,1,'Synthetic','','','','2026-09-02T05:29:54.764Z','','Проверено','2026-09-02T05:31:08.802Z']
  ];
}

function historyValues() {
  return [
    ['Event ID','Rule ID','Событие','Дата/время','Статус до','Статус после','Исполнитель','Плановый эффект / риск','Фактический эффект','Источник / доказательство','Комментарий'],
    ['EVT-1','DEC-CASH-GAP','Создано','2026-09-07T09:00:00Z','','Не начато','AI',613941.1775,'','Decision Engine',''],
    ['SMOKE-1','DEC-SYNTH-SMOKE','Завершено','2026-09-02T05:29:54.764Z','В работе','Готово','AI',1,'','Synthetic hidden lifecycle test','']
  ];
}

function makeMatrices(overrides = {}) {
  return {
    [RANGES.dataHealth]: overrides.dataHealth ?? dataHealthValues(),
    [RANGES.sales]: overrides.sales ?? salesValues(),
    [RANGES.receivables]: overrides.receivables ?? receivablesValues(),
    [RANGES.obligations]: overrides.obligations ?? obligationValues(),
    [RANGES.adjustments]: overrides.adjustments ?? adjustmentValues(),
    [RANGES.drivingFund]: overrides.drivingFund ?? drivingFundValues(),
    [RANGES.decisions]: overrides.decisions ?? decisionValues(),
    [RANGES.history]: overrides.history ?? historyValues()
  };
}

function makeSheets({ matrices = makeMatrices(), forecast = forecastValues() } = {}) {
  const calls = { get: [], batchGet: [] };
  const sheets = {
    spreadsheets: {
      values: {
        async get(args) {
          calls.get.push(structuredClone(args));
          return { data: { values: forecast } };
        },
        async batchGet(args) {
          calls.batchGet.push(structuredClone(args));
          return {
            data: {
              valueRanges: args.ranges.map(range => ({ range, values: matrices[range] }))
            }
          };
        }
      }
    }
  };
  return { sheets, calls };
}

test('reads the exact bounded owner ranges and returns normalized immutable live facts', async () => {
  const createOwnerLiveSourceReader = await loadReader();
  assert.equal(typeof createOwnerLiveSourceReader, 'function');

  const matrices = makeMatrices();
  const sourceBefore = structuredClone(matrices);
  const { sheets, calls } = makeSheets({ matrices });
  const reader = createOwnerLiveSourceReader({
    sheets,
    spreadsheetId: 'sheet-123',
    now: () => new Date('2026-09-07T10:00:00Z')
  });

  const result = await reader.readOwnerLiveFacts();

  assert.deepEqual(calls.get, [{
    spreadsheetId: 'sheet-123',
    range: "'Прогноз 30 дней'!A1:R34",
    valueRenderOption: 'UNFORMATTED_VALUE'
  }]);
  assert.deepEqual(calls.batchGet, [{
    spreadsheetId: 'sheet-123',
    ranges: Object.values(RANGES),
    valueRenderOption: 'UNFORMATTED_VALUE'
  }]);

  assert.equal(result.businessDate, '2026-09-07');
  assert.equal(result.forecast.availableCash, 144084);
  assert.equal(result.dataHealth.status, 'BLOCKED');
  assert.deepEqual(result.sales, {
    monthlyPlan: 10560000,
    planToDate: 2439725.94,
    dayFact: 143000,
    monthFact: 1519894
  });
  assert.deepEqual(result.receivables, {
    contracts: 177,
    debt: 3202805,
    sales: 6315867,
    paid: 3113062
  });
  assert.equal(result.obligations.openCashNeed, 192903.74);
  assert.equal(result.obligations.confirmedCashNeed, 192403.74);
  assert.equal(result.obligations.unconfirmedCashNeed, 500);
  assert.equal(result.obligations.unconfirmedAmountMissing, false);
  assert.equal(result.drivingFund.requiredReserve, 2605956.5093401885);
  assert.equal(result.drivingFund.liveBalance, 91283.44);
  assert.equal(result.drivingFund.deficit, 2514673.0693401885);
  assert.equal(result.decisions[0].ruleId, 'DEC-CASH-GAP');
  assert.equal(result.decisions[1].synthetic, true);
  assert.equal(result.history[0].eventId, 'EVT-1');
  assert.equal(result.history[1].synthetic, true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.sales), true);
  assert.deepEqual(matrices, sourceBefore);
});

test('fails closed when the current city sales row is duplicated', async () => {
  const createOwnerLiveSourceReader = await loadReader();
  const { sheets } = makeSheets({ matrices: makeMatrices({ sales: salesValues({ duplicateCity: true }) }) });
  const reader = createOwnerLiveSourceReader({
    sheets,
    spreadsheetId: 'sheet-123',
    now: () => new Date('2026-09-07T10:00:00Z')
  });

  await assert.rejects(() => reader.readOwnerLiveFacts(), /owner live sales city row is ambiguous/i);
});

test('fails closed when the receivables total row is missing', async () => {
  const createOwnerLiveSourceReader = await loadReader();
  const { sheets } = makeSheets({ matrices: makeMatrices({ receivables: receivablesValues({ includeTotal: false }) }) });
  const reader = createOwnerLiveSourceReader({
    sheets,
    spreadsheetId: 'sheet-123',
    now: () => new Date('2026-09-07T10:00:00Z')
  });

  await assert.rejects(() => reader.readOwnerLiveFacts(), /owner live receivables total row is missing/i);
});

test('does not guess an amount for an unconfirmed obligation with missing net cash outflow', async () => {
  const createOwnerLiveSourceReader = await loadReader();
  const { sheets } = makeSheets({
    matrices: makeMatrices({ obligations: obligationValues({ missingUnconfirmedAmount: true }) })
  });
  const reader = createOwnerLiveSourceReader({
    sheets,
    spreadsheetId: 'sheet-123',
    now: () => new Date('2026-09-07T10:00:00Z')
  });

  const result = await reader.readOwnerLiveFacts();
  assert.equal(result.obligations.openCashNeed, 192403.74);
  assert.equal(result.obligations.unconfirmedCashNeed, 0);
  assert.equal(result.obligations.unconfirmedAmountMissing, true);
});
