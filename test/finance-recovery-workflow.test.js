import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const hourlyWorkflow = readFileSync(
  new URL('../.github/workflows/hourly-project-continuation.yml', import.meta.url),
  'utf8'
);
const recoveryUrl = new URL('../.github/workflows/finance-recovery.yml', import.meta.url);

test('finance recovery uses a dedicated off-peak scheduled workflow', () => {
  assert.equal(existsSync(fileURLToPath(recoveryUrl)), true, 'dedicated finance recovery workflow is required');
  const recoveryWorkflow = readFileSync(recoveryUrl, 'utf8');

  assert.match(recoveryWorkflow, /cron:\s*'7,17,27,37,47,57 4-15 \* \* \*'/);
  assert.match(recoveryWorkflow, /group:\s*finance-recovery/);
  assert.match(recoveryWorkflow, /body:\s*JSON\.stringify\(\{ mode: 'finance_sync', kind: 'recovery' \}\)/);
  assert.doesNotMatch(hourlyWorkflow, /cron:\s*'\*\/10 4-15 \* \* \*'/);
});

test('finance sync script receives the GitHub event name before choosing recovery mode', () => {
  assert.match(
    hourlyWorkflow,
    /GITHUB_EVENT_NAME:\s*\$\{\{\s*github\.event_name\s*\}\}/
  );
});
