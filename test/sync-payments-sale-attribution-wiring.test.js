import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('payment sync writes sale employee attribution without adding an API function', async () => {
  const source = await readFile(new URL('../api/sync-payments.js', import.meta.url), 'utf8');
  assert.match(source, /createAshkWebSession/);
  assert.match(source, /createAshkSaleSource/);
  assert.match(source, /attributePaymentsToSales/);
  assert.match(source, /SaleEmployeeName/);
  assert.match(source, /SaleAttributionStatus/);
  assert.match(source, /АШК_Продажи__vercel/);
  assert.match(source, /'ASHK_WEB_LOGIN'/);
  assert.match(source, /'ASHK_WEB_PASSWORD'/);
  assert.doesNotMatch(source, /const\s+ASHK_WEB_(?:LOGIN|PASSWORD)\s*=\s*['"][^'"]+['"]/);
});
