import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('queue route wires Sheets transport into the existing decision lifecycle', () => {
  const source = fs.readFileSync(path.join(here, '..', 'api', 'owner-action-queue.js'), 'utf8');
  assert.match(source, /createOwnerActionQueueApi/);
  assert.match(source, /createOwnerActionQueueSheetAdapter/);
  assert.match(source, /createOwnerActionControlSheetAdapter/);
  assert.match(source, /createDecisionEventApi/);
  assert.match(source, /google\.auth\.JWT/);
  assert.match(source, /spreadsheets/);
  assert.match(source, /VECTOR_SYNC_KEY/);
  assert.match(source, /TOCHKA_BRIDGE_KEY/);
});
