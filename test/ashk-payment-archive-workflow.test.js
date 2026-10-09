import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const path = new URL('../.github/workflows/ashk-payment-archive.yml', import.meta.url);

test('historical archive workflow is owner-only, manual, read-only and uploads only encrypted facts', async () => {
  const workflow = await readFile(path, 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.doesNotMatch(workflow, /inputs:/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /github\.actor_id\s*==\s*'46207692'/);
  assert.match(workflow, /github\.triggering_actor\s*==\s*github\.actor/);
  assert.match(workflow, /scripts\/export-ashk-payment-archive\.mjs/);
  assert.match(workflow, /ARCHIVE_PUBLIC_KEY_PATH/);
  assert.match(workflow, /ARCHIVE_START_DATE:\s*'2026-09-01'/);
  assert.match(workflow, /ARCHIVE_END_DATE:\s*'2026-09-30'/);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}\s+# v7/);
  assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}\s+# v7/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}\s+# v4/);
  assert.doesNotMatch(workflow, /uses:\s*actions\/[\w-]+@v\d/);
  assert.match(workflow, /ashk-payments\.enc\.json/);
  assert.match(workflow, /retention-days:\s*7/);
  assert.doesNotMatch(workflow, /path:\s*ashk-payments\.json/);
  assert.doesNotMatch(workflow, /google|sheets|sync-payments/i);
});

test('committed archive encryption key contains public material only', async () => {
  const publicKey = await readFile(
    new URL('../config/ashk-payment-archive-public-key.pem', import.meta.url),
    'utf8'
  );
  assert.match(publicKey, /^-----BEGIN PUBLIC KEY-----/);
  assert.doesNotMatch(publicKey, /PRIVATE KEY/);
  assert.equal(createPublicKey(publicKey).asymmetricKeyType, 'rsa');
});

test('repository ignores archive private keys by name', async () => {
  const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(gitignore, /\*-private-key\.pem/);
});
