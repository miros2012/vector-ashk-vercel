import test from 'node:test';
import assert from 'node:assert/strict';

test('production nightly finance entrypoint imports successfully', async () => {
  const previousApiKey = process.env.ASHK_API_KEY;
  process.env.ASHK_API_KEY = 'ci-runtime-import-placeholder';
  try {
    const module = await import('../api/nightly-finance-orchestrator.js');
    assert.equal(typeof module.default, 'function');
  } finally {
    if (previousApiKey === undefined) delete process.env.ASHK_API_KEY;
    else process.env.ASHK_API_KEY = previousApiKey;
  }
});