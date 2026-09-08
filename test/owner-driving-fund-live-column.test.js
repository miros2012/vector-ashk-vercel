import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Owner Driving Fund parser follows the live sheet value column I and ignores trailing empty J', () => {
  const source = readFileSync(new URL('../lib/owner-live-source-reader.js', import.meta.url), 'utf8');

  assert.match(source, /drivingFund:\s*["']'Фонд вождения'!A21:J30["']/);
  assert.match(
    source,
    /requiredFinite\(row\[8\],\s*`owner live driving fund \$\{label\}`\)/,
    'live Driving Fund values are in column I (zero-based index 8)'
  );
  assert.doesNotMatch(
    source,
    /requiredFinite\(row\[9\],\s*`owner live driving fund \$\{label\}`\)/,
    'trailing column J is empty in the live sheet and must not be treated as the value column'
  );
});
