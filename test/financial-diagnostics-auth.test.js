import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

let sequence = 0;
function response() {
  return { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

async function harness(t, route) {
  const key = `diagnosticAuth${++sequence}`;
  const calls = [];
  globalThis[key] = { auth: class { async authorize() { calls.push('google'); throw Error('injected Google boundary'); } } };
  const url = new URL(`../api/${route}.js?auth-test=${sequence}`, import.meta.url).href;
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL === url && specifier === 'googleapis') return {
      url: `data:text/javascript,${encodeURIComponent(`const f = globalThis[${JSON.stringify(key)}]; export const google = {auth: {JWT: f.auth}};`)}`,
      shortCircuit: true
    };
    return next(specifier, context);
  } });
  t.mock.method(globalThis, 'fetch', async () => { calls.push('ashk'); throw Error('injected ASHK boundary'); });
  const names = ['CRON_SECRET', 'ASHK_API_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.CRON_SECRET = 'test-diagnostic-secret';
  process.env.ASHK_API_KEY = 'test-only';
  t.after(() => {
    hook.deregister(); delete globalThis[key];
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  });
  return { handler: (await import(url)).default, calls };
}

for (const route of ['hours-date-diagnostic', 'master-hours-diagnostic']) {
  test(`${route}: denies missing, wrong and unconfigured secrets before external I/O`, async t => {
    const f = await harness(t, route);
    for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
      const res = response();
      await f.handler({ method: 'GET', headers }, res);
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.body, { ok: false, error: 'forbidden' });
    }
    delete process.env.CRON_SECRET;
    const res = response();
    await f.handler({ method: 'GET', headers: { authorization: 'Bearer test-diagnostic-secret' } }, res);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(f.calls, []);
  });

  test(`${route}: valid secret reaches the mocked read-only boundary`, async t => {
    const f = await harness(t, route);
    const res = response();
    await f.handler({ method: 'GET', headers: { authorization: 'Bearer test-diagnostic-secret' } }, res);
    assert.equal(f.calls.length, 1);
    assert.equal(res.statusCode, route === 'hours-date-diagnostic' ? 500 : 502);
  });

  test(`${route}: unsupported methods never touch sources`, async t => {
    const f = await harness(t, route);
    const res = response();
    await f.handler({ method: 'PUT', headers: { authorization: 'Bearer test-diagnostic-secret' } }, res);
    assert.equal(res.statusCode, 405);
    assert.deepEqual(f.calls, []);
  });
}
