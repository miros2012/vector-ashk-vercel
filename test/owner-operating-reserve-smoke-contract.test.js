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

test('OIDC Owner smoke no longer hardcodes the pre-reserve withdrawal or undefined-reserve blocker', () => {
  const source = read('lib/owner-package-oidc-smoke.js');

  assert.doesNotMatch(source, /VECTOR_OWNER_EXPECTED_SAFE_WITHDRAWAL/);
  assert.doesNotMatch(source, /VECTOR_OWNER_REQUIRED_POLICY_BLOCKER/);
  assert.doesNotMatch(source, /OPERATING_RESERVE_UNDEFINED/);
});

test('workflow attestation requires a defined reserve and accepts only finite non-negative safe withdrawal', () => {
  const workflow = read('.github/workflows/hourly-project-continuation.yml');

  assert.match(workflow, /Number\.isFinite\(attestation\?\.safeWithdrawal\)/);
  assert.match(workflow, /attestation\?\.safeWithdrawal\s*<\s*0/);
  assert.match(workflow, /attestation\?\.operatingReserveDefined\s*!==\s*true/);
  assert.match(workflow, /OPERATING_RESERVE_UNDEFINED/);
  assert.match(workflow, /includes\(['"]OPERATING_RESERVE_UNDEFINED['"]\)/);
  assert.doesNotMatch(workflow, /attestation\?\.safeWithdrawal\s*!==\s*0/);
  assert.doesNotMatch(workflow, /attestation\?\.operatingReserveDefined\s*!==\s*false/);
  assert.doesNotMatch(workflow, /550000|550_000/);
});
