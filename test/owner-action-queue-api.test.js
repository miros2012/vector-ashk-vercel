import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerActionQueueApi } from '../lib/owner-action-queue-api.js';

function responseRecorder() {
  return {
    code: null, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('authorized POST processes READY commands and returns aggregate only', async () => {
  let reads = 0;
  const handler = createOwnerActionQueueApi({
    configuredKey: 'secret',
    readReadyCommands: async () => { reads += 1; return []; },
    markCommand: async () => {},
    executeCommand: async () => ({ ok: true })
  });
  const res = responseRecorder();

  await handler({ method: 'POST', headers: { 'x-vector-key': 'secret' } }, res);

  assert.equal(reads, 1);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true, staged: 0, ready: 0, succeeded: 0, failed: 0 });
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('wrong key is rejected before queue read', async () => {
  let reads = 0;
  const handler = createOwnerActionQueueApi({
    configuredKey: 'secret',
    readReadyCommands: async () => { reads += 1; return []; },
    markCommand: async () => {},
    executeCommand: async () => ({ ok: true })
  });
  const res = responseRecorder();

  await handler({ method: 'POST', headers: { authorization: 'Bearer wrong' } }, res);

  assert.equal(res.code, 403);
  assert.equal(reads, 0);
});

test('non-POST is rejected before queue read', async () => {
  let reads = 0;
  const handler = createOwnerActionQueueApi({
    configuredKey: 'secret',
    readReadyCommands: async () => { reads += 1; return []; },
    markCommand: async () => {},
    executeCommand: async () => ({ ok: true })
  });
  const res = responseRecorder();

  await handler({ method: 'GET', headers: { 'x-vector-key': 'secret' } }, res);

  assert.equal(res.code, 405);
  assert.equal(reads, 0);
});

test('stages the dashboard control before consuming READY queue rows', async () => {
  const order = [];
  const handler = createOwnerActionQueueApi({
    configuredKey: 'secret',
    readControl: async () => {
      order.push('control');
      return {
        ruleId:'DEC-1', expectedExecutionStatus:'Не начато', requestedAction:'В работу',
        currentRequestId:''
      };
    },
    appendCommand: async () => order.push('append'),
    setControlState: async () => order.push('state'),
    requestId: () => 'req-dashboard-1',
    readReadyCommands: async () => { order.push('queue'); return []; },
    markCommand: async () => {},
    executeCommand: async () => ({ ok: true })
  });
  const res = responseRecorder();

  await handler({ method:'POST', headers:{ 'x-vector-key':'secret' } }, res);

  assert.deepEqual(order, ['control','append','state','queue']);
  assert.equal(res.code, 200);
  assert.equal(res.body.staged, 1);
});
