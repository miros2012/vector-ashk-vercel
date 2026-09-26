import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/sync-payments.js';

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = Number(code); return this; },
    json(body) { this.body = body; return this; }
  };
}

test('payment staging rejects unauthorized calls before Google or ASHK configuration is used', async () => {
  const names = ['CRON_SECRET', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'ASHK_API_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.CRON_SECRET = 'cron-secret';
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
    delete process.env.ASHK_API_KEY;

    for (const headers of [{}, { authorization: 'Bearer wrong-secret' }]) {
      const res = response();
      await handler({ method: 'POST', headers }, res);
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.body, { ok: false, error: 'forbidden' });
    }

    const methodRes = response();
    await handler({ method: 'GET', headers: {} }, methodRes);
    assert.equal(methodRes.statusCode, 405);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('payment staging rejects when the configured cron secret is empty', async () => {
  const previous = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    const res = response();
    await handler({ method: 'POST', headers: { authorization: 'Bearer anything' } }, res);
    assert.equal(res.statusCode, 403);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
