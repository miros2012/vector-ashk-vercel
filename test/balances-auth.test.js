import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/balances.js';

function response() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = Number(code); return this; },
    json(body) { this.body = body; return this; }
  };
}

test('balance route authenticates each mutation mode before external dependencies', async () => {
  const names = [
    'CRON_SECRET', 'TOCHKA_BRIDGE_KEY', 'VECTOR_SYNC_KEY',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'
  ];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalConsoleError = console.error;
  const errors = [];
  try {
    console.error = (...args) => { errors.push(args); };
    process.env.CRON_SECRET = 'cron-secret';
    process.env.TOCHKA_BRIDGE_KEY = 'bridge-secret';
    delete process.env.VECTOR_SYNC_KEY;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;

    for (const headers of [{}, { authorization: 'Bearer wrong-secret' }]) {
      const res = response();
      await handler({ method: 'GET', headers }, res);
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.body, { ok: false, error: 'forbidden' });
    }

    for (const headers of [
      { 'x-vector-refresh': 'tochka-webhook' },
      { 'x-vector-refresh': 'tochka-webhook', 'x-vector-key': 'wrong-secret' },
      { 'x-vector-key': 'bridge-secret' }
    ]) {
      const res = response();
      await handler({ method: 'POST', headers }, res);
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.body, { ok: false, error: 'forbidden' });
    }

    const ordinaryPost = response();
    await handler({ method: 'POST', headers: { authorization: 'Bearer cron-secret' } }, ordinaryPost);
    assert.equal(ordinaryPost.statusCode, 405);

    const unsupported = response();
    await handler({ method: 'PUT', headers: {} }, unsupported);
    assert.equal(unsupported.statusCode, 405);

    const authenticatedGet = response();
    await handler({ method: 'GET', headers: { authorization: 'Bearer cron-secret' } }, authenticatedGet);
    assert.equal(authenticatedGet.statusCode, 500);

    const authenticatedWebhook = response();
    await handler({
      method: 'POST',
      headers: { 'x-vector-refresh': 'tochka-webhook', 'x-vector-key': 'bridge-secret' }
    }, authenticatedWebhook);
    assert.equal(authenticatedWebhook.statusCode, 500);
    assert.doesNotMatch(JSON.stringify(errors), /cron-secret|bridge-secret/);
  } finally {
    console.error = originalConsoleError;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('balance route fails closed when configured secrets are empty', async () => {
  const cron = process.env.CRON_SECRET;
  const bridge = process.env.TOCHKA_BRIDGE_KEY;
  const fallback = process.env.VECTOR_SYNC_KEY;
  try {
    delete process.env.CRON_SECRET;
    delete process.env.TOCHKA_BRIDGE_KEY;
    delete process.env.VECTOR_SYNC_KEY;

    const getRes = response();
    await handler({ method: 'GET', headers: { authorization: 'Bearer anything' } }, getRes);
    assert.equal(getRes.statusCode, 403);

    const postRes = response();
    await handler({
      method: 'POST',
      headers: { 'x-vector-refresh': 'tochka-webhook', 'x-vector-key': 'anything' }
    }, postRes);
    assert.equal(postRes.statusCode, 403);
  } finally {
    if (cron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = cron;
    if (bridge === undefined) delete process.env.TOCHKA_BRIDGE_KEY; else process.env.TOCHKA_BRIDGE_KEY = bridge;
    if (fallback === undefined) delete process.env.VECTOR_SYNC_KEY; else process.env.VECTOR_SYNC_KEY = fallback;
  }
});
