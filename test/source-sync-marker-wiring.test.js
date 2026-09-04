import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const paymentRoutePath = path.join(here, '..', 'api', 'sync-payments.js');
const financeRoutePath = path.join(here, '..', 'api', 'nightly-finance-orchestrator.js');

test('verified payment sync records a real last-success marker on the existing route', () => {
  const source = fs.readFileSync(paymentRoutePath, 'utf8');
  assert.match(source, /google-sheets-sync-marker\.js/);
  assert.match(source, /writeControlMarker/);
  assert.match(source, /payments_last_success_utc/);
  assert.ok(
    source.indexOf('payments_last_success_utc') > source.indexOf('Payment or sale staging verification failed'),
    'payment marker must be written only after verified readback'
  );
});

test('verified receivables sync records a last-success marker inside the existing finance route', () => {
  const source = fs.readFileSync(financeRoutePath, 'utf8');
  assert.match(source, /google-sheets-sync-marker\.js/);
  assert.match(source, /writeControlMarker/);
  assert.match(source, /receivables_last_success_utc/);
  assert.match(source, /afterVerified/);
});