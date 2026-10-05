import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { financeSourceRouteHarness, CONTRACT_SHEET, CONTRACT_HEADERS } from './helpers/finance-source-route-harness.js';

let sequence = 0;
const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} });

// Keep actual route writer callbacks and Google Sheets snapshot helper; replace
// only the Google client and consumer factory to expose those callbacks.
async function writerHarness(t, routeName, { failWrite = false, corruptReadback = false, failFirstAuth = false } = {}) {
  const key = `snapshotWriter${++sequence}`;
  const old = [['header', 'amount'], ['old', 10], ['obsolete', 20]];
  let rows = structuredClone(old);
  let writes = 0;
  let authCalls = 0;
  const requests = [];
  const capture = (name, fn) => async (args, options) => {
    requests.push({ name, args, options });
    return fn(args);
  };
  const read = () => {
    const result = structuredClone(rows).map(row => {
      while (row.length && row.at(-1) === '') row.pop();
      return row;
    });
    while (result.length && !result.at(-1).length) result.pop();
    if (corruptReadback && writes && result[1]) result[1][1] = 999;
    return result;
  };
  const fixture = { callbacks: null, google: {
    auth: { JWT: class { async authorize() { if (++authCalls === 1 && failFirstAuth) throw Error('authorization unavailable'); } } },
    sheets: () => ({ spreadsheets: {
      get: capture('metadata', async () => ({ data: { sheets: [] } })),
      batchUpdate: capture('prepare', async () => ({ data: {} })),
      values: {
        get: capture('read', async () => ({ data: { values: read() } })),
        batchGet: capture('snapshot-read', async () => ({ data: { valueRanges: [{ values: read() }] } })),
        clear: async () => { rows = []; },
        update: async ({ requestBody }) => { if (failWrite) throw Error('injected write failure'); writes++; rows = structuredClone(requestBody.values); },
        batchUpdate: capture('snapshot-write', async ({ requestBody }) => { if (failWrite) throw Error('injected write failure'); writes++; rows = structuredClone(requestBody.data[0].values); })
      }
    } })
  } };
  globalThis[key] = fixture;
  const url = new URL(`../api/${routeName}.js?writer-test=${sequence}`, import.meta.url).href;
  const factories = {
    '../lib/sync-hours-handler.js': 'export const createSyncHoursHandler = options => { f.callbacks = options; return () => {}; };',
    '../lib/rop-publisher.js': 'export const createRopPublisher = options => { f.callbacks = options; return () => {}; };'
  };
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL === url && (specifier === 'googleapis' || factories[specifier])) {
      const code = `const f = globalThis[${JSON.stringify(key)}]; ${specifier === 'googleapis' ? 'export const google = f.google;' : factories[specifier]}`;
      return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true };
    }
    return next(specifier, context);
  } });
  const names = ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) process.env[name] = 'test-only';
  t.after(() => {
    hook.deregister(); delete globalThis[key];
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  });
  await import(url);
  return { callbacks: fixture.callbacks, old, read, requests, get authCalls() { return authCalls; } };
}

for (const route of ['sync-hours', 'health']) {
  const write = (f, values) => route === 'sync-hours'
    ? f.callbacks.writeRaw(values)
    : f.callbacks.writeSheet('target-book', 'РОП_Штаб_Утро', values);
  test(`${route}: failed write preserves the last published snapshot`, async t => {
    const f = await writerHarness(t, route, { failWrite: true });
    await assert.rejects(write(f, [['header', 'amount'], ['new', 30]]), /injected write failure/);
    assert.deepEqual(f.read(), f.old);
  });
  test(`${route}: shorter snapshot removes obsolete tail rows`, async t => {
    const f = await writerHarness(t, route);
    const next = [['header', 'amount'], ['new', 30]];
    await write(f, next);
    assert.deepEqual(f.read(), next);
  });
  test(`${route}: publication and source reads forward finite SDK deadlines without automatic retry`, async t => {
    const f = await writerHarness(t, route);
    await write(f, [['header', 'amount'], ['new', 30]]);
    if (route === 'sync-hours') await f.callbacks.readRaw();
    else {
      await f.callbacks.readSheet('РОП_Штаб_Утро');
      await f.callbacks.readTargetSheet('target-book', 'РОП_Штаб_Утро');
    }
    assert.ok(f.requests.some(request => request.name === 'metadata'));
    assert.ok(f.requests.some(request => request.name === 'prepare'));
    assert.ok(f.requests.some(request => request.name === 'read'));
    for (const request of f.requests) {
      assert.ok(request.options?.timeout > 0 && request.options.timeout < 60000, `${request.name} lacks finite SDK deadline`);
      assert.equal(request.options.retry, false);
    }
  });
  test(`${route}: failed cached authorization can recover on the next invocation`, async t => {
    const f = await writerHarness(t, route, { failFirstAuth: true });
    await assert.rejects(write(f, [['header', 'amount'], ['new', 30]]), /authorization unavailable/);
    assert.deepEqual(f.read(), f.old);
    await write(f, [['header', 'amount'], ['new', 30]]);
    assert.deepEqual(f.read(), [['header', 'amount'], ['new', 30]]);
    assert.equal(f.authCalls, 2);
  });
}

test('finance source route: failed contract write preserves the previous snapshot and marker', async t => {
  const old = [CONTRACT_HEADERS, [1, '2026-09-01', 'Branch', 'Branch', 'Manager', 100, 50, 50, 'old', 'contract']];
  const f = await financeSourceRouteHarness(t, { initialContracts: old, contractFault: 'write' });
  await f.route.runReceivablesNow({ method: 'GET' }, response());
  assert.deepEqual(f.tables.get(CONTRACT_SHEET), old);
  assert.equal(f.tables.get('__vercel_control')[0][1], 'old-marker');
});

test('ROP publication rejects same-size readback with changed amounts', async t => {
  const f = await writerHarness(t, 'health', { corruptReadback: true });
  await assert.rejects(f.callbacks.writeSheet('target-book', 'РОП_Штаб_Утро', [['header', 'amount'], ['new', 30]]), /ROP publish verification failed/);
});

test('finance source route bounds prepare, source reads, snapshots, formatting and marker I/O', async t => {
  const f = await financeSourceRouteHarness(t);
  const res = response();
  await f.route.runReceivablesNow({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  for (const request of f.requests) {
    assert.ok(request.options?.timeout > 0 && request.options.timeout < 60000, `${request.name} lacks finite SDK deadline`);
    assert.equal(request.options.retry, false);
  }
});

test('stalled contract readback returns retryable failure without marking source fresh', async t => {
  const f = await financeSourceRouteHarness(t, { contractFault: 'stall-read', requestTimeoutMs: 20 });
  const res = response();
  let watchdog;
  try {
    const outcome = await Promise.race([
      f.route.runReceivablesNow({ method: 'GET' }, res).then(() => 'returned'),
      new Promise(resolve => { watchdog = setTimeout(() => resolve('stalled'), 200); })
    ]);
    assert.equal(outcome, 'returned', 'source route never returned on stalled Sheets readback');
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.errorClass, 'SHEETS_READBACK');
    assert.equal(res.body.retryable, true);
    assert.equal(f.tables.get('__vercel_control')[0][1], 'old-marker');
    assert.equal(f.events.includes('publish'), false);
  } finally { clearTimeout(watchdog); }
});
