import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(here, '..', 'api', 'nightly-finance-orchestrator.js');

test('nightly finance route composes HOURS, decisions, and runtime CRON_SECRET', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /sync-hours\.js/);
  assert.match(source, /decision-reconcile-daily\.js/);
  assert.match(source, /createNightlyFinanceOrchestrator/);
  assert.match(source, /process\.env\.CRON_SECRET/);
});
