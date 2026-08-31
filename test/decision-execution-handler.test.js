import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionExecutionHandler } from '../lib/decision-execution-handler.js';

function responseRecorder() {
  return {
    code: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function current() {
  return {
    ruleId: 'DEC-CRIT-DUE',
    executionStatus: 'Не начато',
    verificationStatus: 'Не проверено',
    plannedEffect: 1179607.47,
    actualEffect: null,
    startedAt: null,
    completedAt: null,
    result: '',
    lastCheckedAt: null
  };
}

test('authorized POST updates decision and appends immutable execution event', async () => {
  const writes = [];
  const events = [];
  const handler = createDecisionExecutionHandler({
    configuredKey: 'secret',
    now: () => new Date('2026-08-31T15:56:00.000Z'),
    getDecision: async (ruleId) => ruleId === 'DEC-CRIT-DUE' ? current() : null,
    writeDecision: async (ruleId, next) => writes.push({ ruleId, next }),
    appendEvent: async (event) => events.push(event)
  });
  const req = {
    method: 'POST',
    headers: { 'x-vector-key': 'secret' },
    body: { ruleId: 'DEC-CRIT-DUE', action: 'start', actor: 'Ответственный за финансы' }
  };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.executionStatus, 'В работе');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].next.executionStatus, 'В работе');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'Взято в работу');
  assert.equal(events[0].ruleId, 'DEC-CRIT-DUE');
});

test('wrong key is rejected before reading or writing data', async () => {
  let reads = 0;
  const handler = createDecisionExecutionHandler({
    configuredKey: 'secret',
    getDecision: async () => { reads += 1; return current(); },
    writeDecision: async () => {},
    appendEvent: async () => {}
  });
  const req = { method: 'POST', headers: { 'x-vector-key': 'wrong' }, body: {} };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.code, 403);
  assert.equal(res.body.ok, false);
  assert.equal(reads, 0);
});

test('unknown rule returns 404 without creating history', async () => {
  let events = 0;
  const handler = createDecisionExecutionHandler({
    configuredKey: 'secret',
    getDecision: async () => null,
    writeDecision: async () => {},
    appendEvent: async () => { events += 1; }
  });
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer secret' },
    body: { ruleId: 'UNKNOWN', action: 'start', actor: 'AI' }
  };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.code, 404);
  assert.equal(events, 0);
});
