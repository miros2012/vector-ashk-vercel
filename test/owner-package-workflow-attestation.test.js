import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('owner-triggered workflow independently verifies the expected production attestation before printing success', () => {
  const workflow = read('.github/workflows/hourly-project-continuation.yml');

  assert.match(workflow, /response\.headers\.get\(['"]cache-control['"]\)/);
  assert.match(workflow, /no-store/i);
  assert.match(workflow, /const\s+attestation\s*=\s*body\?\.attestation/);
  assert.match(workflow, /Number\.isFinite\(attestation\?\.ageMs\)/);
  assert.match(workflow, /attestation\.ageMs\s*<\s*0/);
  assert.match(workflow, /attestation\.ageMs\s*>\s*300000/);
  assert.match(workflow, /Number\.isFinite\(attestation\?\.safeWithdrawal\)/);
  assert.match(workflow, /attestation\?\.safeWithdrawal\s*<\s*0/);
  assert.match(workflow, /attestation\?\.operatingReserveDefined\s*!==\s*true/);
  assert.match(workflow, /attestation\.policyBlockers\.includes\(['"]OPERATING_RESERVE_UNDEFINED['"]\)/);
  assert.doesNotMatch(workflow, /attestation\?\.safeWithdrawal\s*!==\s*0/);
  assert.doesNotMatch(workflow, /attestation\?\.operatingReserveDefined\s*!==\s*false/);
  assert.doesNotMatch(workflow, /550000|550_000/);
});
