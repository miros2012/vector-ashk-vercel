import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('sale archive workflow is owner-only, manual, read-only and uploads ciphertext only', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ashk-sale-archive.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:|inputs:/);
  assert.match(workflow, /github\.actor_id\s*==\s*'46207692'/);
  assert.match(workflow, /github\.triggering_actor\s*==\s*github\.actor/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /scripts\/export-ashk-sale-archive\.mjs/);
  assert.match(workflow, /ARCHIVE_START_DATE:\s*'2026-09-01'/);
  assert.match(workflow, /ARCHIVE_END_DATE:\s*'2026-09-30'/);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}\s+# v7/);
  assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}\s+# v7/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}\s+# v4/);
  assert.match(workflow, /ashk-sales\.enc\.json/);
  assert.doesNotMatch(workflow, /path:\s*ashk-sales\.json/);
  assert.doesNotMatch(workflow, /google|sheets|sync-payments/i);
});
