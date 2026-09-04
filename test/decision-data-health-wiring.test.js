import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(here, '..', 'api', 'decision-reconcile-daily.js');

test('decision reconciliation exposes Data Health pre-flight on the existing handler', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /data-health-snapshot\.js/);
  assert.match(source, /Data Health Snapshot/);
  assert.match(source, /evaluateDataHealthSnapshot/);
  assert.match(source, /handler\.dataHealth/);
  assert.match(source, /`'\$\{DATA_HEALTH_SHEET\}'!A1:H40`/);
});