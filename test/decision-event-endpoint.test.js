import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('decision-event endpoint wires Google Sheets and protected execution API', () => {
  const source = fs.readFileSync(path.join(here, '..', 'api', 'decision-event.js'), 'utf8');
  assert.match(source, /createDecisionEventApi/);
  assert.match(source, /google\.auth\.JWT/);
  assert.match(source, /GOOGLE_SERVICE_ACCOUNT_EMAIL/);
  assert.match(source, /GOOGLE_PRIVATE_KEY/);
  assert.match(source, /VECTOR_SYNC_KEY/);
  assert.match(source, /TOCHKA_BRIDGE_KEY/);
});

test('decision-event endpoint dispatches rewritten owner dashboard routes', () => {
  const source = fs.readFileSync(path.join(here, '..', 'api', 'decision-event.js'), 'utf8');
  assert.match(source, /createOwnerActionApi/);
  assert.match(source, /createDecisionEffectivenessApi/);
  assert.match(source, /createOwnerActionQueueApi/);
  assert.match(source, /ownerRoute/);
});
