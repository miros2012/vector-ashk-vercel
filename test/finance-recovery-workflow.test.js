import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/hourly-project-continuation.yml', import.meta.url),
  'utf8'
);

test('finance recovery schedule cannot displace the hourly project continuation run', () => {
  assert.match(workflow, /cron:\s*'\*\/10 4-15 \* \* \*'/);
  assert.match(
    workflow,
    /group:\s*\$\{\{\s*github\.event\.schedule\s*==\s*'\*\/10 4-15 \* \* \*'\s*&&\s*'finance-recovery'\s*\|\|\s*'hourly-project-continuation'\s*\}\}/
  );
});


test('finance sync script receives the GitHub event name before choosing recovery mode', () => {
  assert.match(
    workflow,
    /GITHUB_EVENT_NAME:\\s*\\$\\{\\{\\s*github\\.event_name\\s*\\}\\}/
  );
});
