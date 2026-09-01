import test from 'node:test';
import assert from 'node:assert/strict';

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('controlled preview check reports CRON_SECRET readiness without running HOURS sync', async () => {
  process.env.VERCEL_ENV = 'preview';
  process.env.VERCEL_GIT_COMMIT_REF = 'preview-nightly-finance-orchestrator-v4';
  process.env.CRON_SECRET = 'test-cron-secret';

  const { default: handler } = await import('../api/sync-hours.js?preview-gate-test=1');
  const req = {
    method: 'GET',
    query: { previewGate: 'check' },
    headers: {}
  };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    previewHoursGate: true,
    cronSecretConfigured: true,
    writesPerformed: false
  });
});
