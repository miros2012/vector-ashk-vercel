import test from 'node:test';
import assert from 'node:assert/strict';

test('production nightly finance entrypoint imports successfully', async () => {
  const module = await import('../api/nightly-finance-orchestrator.js');
  assert.equal(typeof module.default, 'function');
});
