import test from 'node:test';
import assert from 'node:assert/strict';
import { createCashPhotoStore } from '../lib/cash-photo-store.js';

function makeStore() {
  const updates = [];
  const drive = { files: {} };
  const sheets = {
    spreadsheets: {
      values: {
        async update(args) {
          updates.push(args);
          return { data: {} };
        }
      }
    }
  };
  const store = createCashPhotoStore({
    drive,
    sheets,
    spreadsheetId: 'sheet',
    folderId: 'folder'
  });
  return { store, updates };
}

function operation({ expense = 0, income = 0, balance, needsReview = false } = {}) {
  return {
    date: '15.09.2026',
    description: 'Операция',
    expense,
    income,
    balance,
    balanceReadable: true,
    confidence: 95,
    needsReview,
    note: ''
  };
}

function recognition(data) {
  return { model: 'gemini-3.5-flash-lite', data };
}

function writtenRow(updates) {
  assert.equal(updates.length, 1);
  assert.equal(updates[0].range, "'Архив кассовых фото'!H302:N302");
  return updates[0].requestBody.values[0];
}

test('clean cash photo stays recognized and awaiting processing', async () => {
  const { store, updates } = makeStore();
  await store.markRecognized({ archiveRow: 302 }, recognition({
    initialBalance: 100,
    visibleMoneyRowCount: 2,
    finalBalance: 110,
    finalBalanceReadable: true,
    pageNote: 'ok',
    operations: [
      operation({ expense: 10, balance: 90 }),
      operation({ income: 20, balance: 110 })
    ]
  }));

  const row = writtenRow(updates);
  assert.equal(row[0], 'Распознано — ожидает обработки');
  assert.equal(row[1], 2);
  assert.equal(row[2], 0);
  assert.equal(row[5], 'ok');
});

test('Melnikaite-style visible row mismatch requires review', async () => {
  const { store, updates } = makeStore();
  await store.markRecognized({ archiveRow: 302 }, recognition({
    initialBalance: 6630,
    visibleMoneyRowCount: 10,
    finalBalance: 67942.5,
    finalBalanceReadable: true,
    pageNote: 'Модель ошибочно заявила, что всё совпадает.',
    operations: [
      operation({ expense: 149, balance: 6481 }),
      operation({ expense: 79, balance: 6402 }),
      operation({ expense: 2000, balance: 4402 }),
      operation({ expense: 236.5, balance: 4165.5 }),
      operation({ expense: 122.99, balance: 4042.51 }),
      operation({ income: 5000, balance: 9042.51 }),
      operation({ expense: 2000, balance: 7042.51 }),
      operation({ income: 14000, balance: 21042.51 }),
      operation({ income: 46900, balance: 67942.51 })
    ]
  }));

  const row = writtenRow(updates);
  assert.equal(row[0], 'Распознано — требуется проверка');
  assert.match(row[5], /10.*9|9.*10/);
});

test('Yamskaya-style arithmetic mismatch requires review even when final balance repeats OCR value', async () => {
  const { store, updates } = makeStore();
  await store.markRecognized({ archiveRow: 302 }, recognition({
    initialBalance: 112710,
    visibleMoneyRowCount: 7,
    finalBalance: 4659,
    finalBalanceReadable: true,
    pageNote: 'Модель считает арифметику корректной.',
    operations: [
      operation({ income: 500, balance: 113210 }),
      operation({ expense: 80000, balance: 33210 }),
      operation({ income: 47900, balance: 81110 }),
      operation({ income: 13300, balance: 94410 }),
      operation({ income: 12500, balance: 106910 }),
      operation({ expense: 2256, balance: 104654 }),
      operation({ expense: 100000, balance: 4659 })
    ]
  }));

  const row = writtenRow(updates);
  assert.equal(row[0], 'Распознано — требуется проверка');
  assert.match(row[5], /4654/);
  assert.match(row[5], /4659/);
});

test('any OCR row explicitly marked needsReview keeps the whole photo in review', async () => {
  const { store, updates } = makeStore();
  await store.markRecognized({ archiveRow: 302 }, recognition({
    initialBalance: 100,
    visibleMoneyRowCount: 1,
    finalBalance: 150,
    finalBalanceReadable: true,
    pageNote: '',
    operations: [operation({ income: 50, balance: 150, needsReview: true })]
  }));

  const row = writtenRow(updates);
  assert.equal(row[0], 'Распознано — требуется проверка');
  assert.equal(row[2], 1);
  assert.match(row[5], /требует проверки/i);
});

test('final page balance mismatch requires review', async () => {
  const { store, updates } = makeStore();
  await store.markRecognized({ archiveRow: 302 }, recognition({
    initialBalance: 100,
    visibleMoneyRowCount: 1,
    finalBalance: 155,
    finalBalanceReadable: true,
    pageNote: '',
    operations: [operation({ income: 50, balance: 150 })]
  }));

  const row = writtenRow(updates);
  assert.equal(row[0], 'Распознано — требуется проверка');
  assert.match(row[5], /155/);
  assert.match(row[5], /150/);
});
