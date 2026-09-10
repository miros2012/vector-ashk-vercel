import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const health = fs.readFileSync(path.join(here, '..', 'api', 'health.js'), 'utf8');

test('one-time Drive API enable route is bounded to explicit route, nonce and cloud-platform auth', () => {
  assert.match(health, /'enable-drive'/);
  assert.match(health, /CASH_PHOTO_ENABLE_DRIVE_NONCE/);
  assert.match(health, /enableCashPhotoDriveApi/);
  assert.match(health, /auth\/cloud-platform/);
  assert.match(health, /operationAccepted: true/);
});

test('one-time Drive API enable route does not mention DDS or bank actions', () => {
  const start = health.indexOf('async function handleCashPhotoEnableDrive');
  const end = health.indexOf('async function handleCashPhotoRoute', start);
  const block = health.slice(start, end);
  assert.doesNotMatch(block, /ДДС|tochka|payment|transfer|writeTargetSheet/i);
});
