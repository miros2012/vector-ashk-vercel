import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');

test('nightly route includes current-month payments before receivables', () => {
  assert.match(source, /import\s+syncPayments\s+from\s+'\.\/sync-payments\.js'/);
  assert.match(source, /runPayments:\s*syncPayments/);
});

test('verified receivables hook builds the live ROP control from the same ASHK contract fetch', () => {
  assert.match(source, /buildRopDailyControlWorkbook/);
  assert.match(source, /РОП_План_Сентябрь/);
  assert.match(source, /РОП_Контроль_Дня/);
  assert.match(source, /АШК_Контракты_ТекущийМесяц__vercel/);
  assert.match(source, /afterVerified/);
  assert.match(source, /АШК_Оплаты__vercel/);
});

test('both ROP refresh paths read the payment employee column from staging', () => {
  const reads = source.match(/readValues\(PAYMENTS_STAGING_SHEET, 'A:I'\)/g) || [];
  assert.equal(reads.length, 2);
});

test('nightly ROP sync persists and readback-verifies unmatched payment diagnostics', () => {
  assert.match(source, /РОП_Неопознанные_Оплаты__diag/);
  assert.match(source, /workbook\.unmatchedPaymentValues/);
  assert.match(source, /unmatchedReadback/);
  assert.match(source, /ID оплаты/);
});

test('ROP sync persists and verifies the debtor priority queue', () => {
  assert.match(source, /РОП_Дебиторка_Приоритет/);
  assert.match(source, /buildRopDebtorPriority/);
  assert.match(source, /debtorPriorityReadback/);
  assert.match(source, /StudentId/);
});
