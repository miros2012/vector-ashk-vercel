import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const balances = fs.readFileSync(path.join(here, '..', 'api', 'balances.js'), 'utf8');
const daily = fs.readFileSync(path.join(here, '..', 'api', 'decision-reconcile-daily.js'), 'utf8');

for (const [name, source] of [['balances', balances], ['daily', daily]]) {
  test(`${name} reconciliation wires append-only audit into reconciler`, () => {
    assert.match(source, /createDecisionReconciliationAudit/);
    assert.match(source, /createDecisionReconciliationAuditAppender/);
    assert.match(source, /audit\s*[,}]/);
  });
}

test('both reconciliation paths use the same dedicated audit sheet name', () => {
  assert.match(balances, /Rule Engine Audit/);
  assert.match(daily, /Rule Engine Audit/);
});
