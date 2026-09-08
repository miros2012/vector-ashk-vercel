import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOwnerPackageKey } from '../lib/owner-package-key.js';

const STRONG_OWNER_KEY = `owner-${'a'.repeat(42)}`;

test('Owner package key resolver rejects credentials shorter than 32 characters', () => {
  assert.equal(resolveOwnerPackageKey({ VECTOR_OWNER_PACKAGE_KEY: 'owner-secret' }), '');
  assert.equal(resolveOwnerPackageKey({ VECTOR_OWNER_PACKAGE_KEY: STRONG_OWNER_KEY }), STRONG_OWNER_KEY);
  assert.equal(resolveOwnerPackageKey({ VECTOR_OWNER_PACKAGE_KEY: `  ${STRONG_OWNER_KEY}  ` }), STRONG_OWNER_KEY);
});
