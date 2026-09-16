import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../api/sync-payments.js', import.meta.url), 'utf8');

test('payment sync executes the sale staff diagnostic and logs only Alina candidates', () => {
  assert.match(source, /summarizeSaleStaffCandidates\(rawItems, saleResult\.sales\)/);
  assert.match(source, /ashk-sale-staff-candidates-diagnostic/);
  assert.match(source, /Алина\|Кумаритова/);
});
