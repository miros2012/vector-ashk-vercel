import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('owner dashboard renders bank operations that need confirmation', () => {
  const html = fs.readFileSync(new URL('../public/owner/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/owner/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="manual-bank"/);
  assert.match(html, /Операции на подтверждение/);
  assert.match(app, /manualBankOperations/);
  assert.match(app, /manual-bank/);
});
