import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/manual-finance-run-handler.js', import.meta.url), 'utf8');

test('manual report-routes probe uses asset-backed ASHK route discovery', () => {
  assert.match(source, /probeAshkReportRoutes/);
  assert.match(source, /return probeAshkReportRoutes\(\{\s*session(?::\s*webSession\(\))?\s*\}\)/);
});
