import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(here, '..', 'api', 'decision-shadow.js');

test('decision shadow route wires Google Sheets adapter into protected read-only API', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /from ['\"]googleapis['\"]/);
  assert.match(source, /createDecisionShadowSheetAdapter/);
  assert.match(source, /createDecisionShadowApi/);
  assert.match(source, /VECTOR_SYNC_KEY/);
  assert.match(source, /TOCHKA_BRIDGE_KEY/);
  assert.match(source, /1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10/);
});
