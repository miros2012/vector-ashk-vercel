import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(here, '..', 'api', 'decision-shadow-status.js');

test('public shadow status route uses the shared adapter with read-only Google Sheets scope', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /from ['\"]googleapis['\"]/);
  assert.match(source, /createDecisionShadowSheetAdapter/);
  assert.match(source, /createDecisionShadowStatusHandler/);
  assert.match(source, /spreadsheets\.readonly/);
  assert.doesNotMatch(source, /spreadsheets['\"]\]/);
  assert.match(source, /1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10/);
});
