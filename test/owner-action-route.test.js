import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('owner-action route wires protected readonly Google Sheets API', () => {
  const source = fs.readFileSync(path.join(here, '..', 'api', 'owner-action.js'), 'utf8');
  assert.match(source, /createOwnerActionApi/);
  assert.match(source, /createOwnerActionSheetAdapter/);
  assert.match(source, /google\.auth\.JWT/);
  assert.match(source, /spreadsheets\.readonly/);
  assert.match(source, /VECTOR_SYNC_KEY/);
  assert.match(source, /TOCHKA_BRIDGE_KEY/);
});
