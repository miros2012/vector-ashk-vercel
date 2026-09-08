import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { timingSafeSecretEqual } from '../lib/secret-compare.js';

test('timingSafeSecretEqual preserves exact secret equality semantics', () => {
  const expected = 'owner-package-key-0123456789abcdef0123456789';

  assert.equal(timingSafeSecretEqual(expected, expected), true);
  assert.equal(timingSafeSecretEqual(`${expected.slice(0, -1)}x`, expected), false);
  assert.equal(timingSafeSecretEqual(expected.slice(0, -1), expected), false);
  assert.equal(timingSafeSecretEqual(`${expected}x`, expected), false);
  assert.equal(timingSafeSecretEqual('', expected), false);
});

test('Owner read-only API uses constant-time secret comparison instead of direct inequality', async () => {
  const source = await readFile(new URL('../lib/owner-readonly-api.js', import.meta.url), 'utf8');

  assert.match(source, /timingSafeSecretEqual\(key, expectedKey\)/);
  assert.doesNotMatch(source, /key\s*!==\s*expectedKey/);
});
