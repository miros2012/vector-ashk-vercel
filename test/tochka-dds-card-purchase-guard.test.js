import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCurrentDayTochkaDdsPlan } from '../lib/tochka-dds-import.js';

const HEADER = [
  'Месяц','Мсц (цифрой)','Дата','Сумма','Кошелек','Направление бизнеса',
  'Контрагент','Назначение платежа','Статья','Платеж/поступл','Вид д-ти',
  'Месяц P&L','Комментарий P&L','Ключ дубля','transactionId'
];

const BUSINESS_DATE = '2026-09-04';
const KEY = '40702810212500010112|cbs-tb;2480849095;1';
const TRANSACTION_ID = 'cbs-tb;2480849095;1';

function cardPurchaseRow({ category = 'Продажи' } = {}) {
  return [
    'Сентябрь', 9, 46269, -14000, 1, '', 'ООО "Банк Точка"',
    'Покупка товара(Терминал:ROSTELECOM.RU,STR 1-YA TVERSKAYA-YAMSKAYA 14,MOSCOW,RU,дата операции:02/09/2026 07:50(МСК),на сумму:14000 RUB,карта 220445******5088)',
    category, 'Выбытие', 'Операционная', 9, `Точка API | ${KEY}`, KEY, TRANSACTION_ID
  ];
}

test('fails closed when a Bank Tochka card purchase is misclassified as Sales', () => {
  assert.throws(() => buildCurrentDayTochkaDdsPlan({
    readyValues: [HEADER, cardPurchaseRow()],
    ddsCommentValues: [],
    journalValues: [],
    businessDate: BUSINESS_DATE,
    now: new Date('2026-09-04T18:00:00.000Z')
  }), /card purchase.*sales/i);
});

test('allows the same card purchase after it has a non-Sales expense category', () => {
  const plan = buildCurrentDayTochkaDdsPlan({
    readyValues: [HEADER, cardPurchaseRow({ category: 'Услуги связи' })],
    ddsCommentValues: [],
    journalValues: [],
    businessDate: BUSINESS_DATE,
    now: new Date('2026-09-04T18:00:00.000Z')
  });

  assert.equal(plan.ddsRows.length, 1);
  assert.equal(plan.ddsRows[0][8], 'Услуги связи');
});
