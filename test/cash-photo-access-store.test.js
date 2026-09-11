import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCashPhotoAccessStore } from '../lib/cash-photo-access-store.js';

const token = 'a'.repeat(43);
const tokenSha256 = createHash('sha256').update(token).digest('hex');
const entry = { accessId: 'BRANCH:ЯМСКАЯ', branch: 'Ямская', label: 'Ямская', active: true, tokenSha256 };

test('private registry derives branch identity and never reads the public sheet', async () => {
  const store = createCashPhotoAccessStore({ registryJson: JSON.stringify([entry]), sheets: { get spreadsheets() { throw Error('Public sheet must not be read'); } } });
  assert.equal(store.configured, true);
  assert.deepEqual(await store.authorize(token), { accessId: 'BRANCH:ЯМСКАЯ', role: 'Филиал', branch: 'Ямская', label: 'Ямская' });
  assert.equal(await store.authorize('b'.repeat(43)), null);
  assert.equal(await store.authorize(tokenSha256), null);
  assert.equal(await store.authorize(''), null);
});

test('missing, malformed, ambiguous and plaintext registries fail closed', async () => {
  const invalid = ['', '{bad', '{}', '[]', JSON.stringify([entry, entry]), JSON.stringify([{ ...entry, active: 'true' }]), JSON.stringify([{ ...entry, branch: '' }]), JSON.stringify([{ ...entry, tokenSha256: '' }]), JSON.stringify([{ ...entry, token }])];
  for (const registryJson of invalid) {
    const store = createCashPhotoAccessStore({ registryJson });
    assert.equal(store.configured, false);
    assert.equal(await store.authorize(token), null);
  }
});

test('disabled branch stays unauthorized even with a matching hash', async () => {
  const store = createCashPhotoAccessStore({ registryJson: JSON.stringify([{ ...entry, active: false }]) });
  assert.equal(await store.authorize(token), null);
});
