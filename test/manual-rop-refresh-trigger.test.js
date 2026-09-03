import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const health = readFileSync(new URL('../api/health.js', import.meta.url), 'utf8');
const nightly = readFileSync(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('one-time ROP refresh invokes verified receivables and ROP sync only', () => {
  assert.match(nightly, /export\s+const\s+runReceivablesNow\s*=\s*syncReceivables/);
  assert.match(health, /runReceivablesNow/);
  assert.match(health, /manual_rop_refresh_token/);
});

test('temporary ROP refresh has enough duration for the ASHK group scan', () => {
  assert.equal(vercel.functions?.['api/health.js']?.maxDuration, 180);
});
