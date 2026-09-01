import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(here, '..', 'api', 'decision-sync.js');

test('decision sync route wires guarded backend state synchronizer with explicit writes flag', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /from ['\"]googleapis['\"]/);
  assert.match(source, /createDecisionShadowSheetAdapter/);
  assert.match(source, /createDecisionStateSynchronizer/);
  assert.match(source, /createDecisionStateSyncHandler/);
  assert.match(source, /https:\/\/www\.googleapis\.com\/auth\/spreadsheets['\"]/);
  assert.match(source, /DECISION_STATE_WRITES_ENABLED\s*===\s*['\"]true['\"]/);
  assert.match(source, /VECTOR_SYNC_KEY/);
  assert.match(source, /TOCHKA_BRIDGE_KEY/);
  assert.match(source, /1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10/);
});
