import test from 'node:test';
import assert from 'node:assert/strict';

import { createSyncHoursHandler } from '../lib/sync-hours-handler.js';

const REPORT_ROWS = [
  {
    EmployeeId: 12,
    MasterName: 'Иванов Иван',
    ContractName: 'B-102',
    FactStart: '2026-08-02 10:00:00',
    SessionTypeName: 'ДОП',
    Hours: 3,
    ParallelHours: 3,
    VisitState: 0
  }
];

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

test('sync-hours rejects an unauthorized request before external calls', async () => {
  let externalCalls = 0;
  const handler = createSyncHoursHandler({
    configuredKey: 'secret',
    fetchReport: async () => { externalCalls += 1; return REPORT_ROWS; },
    writeRaw: async () => { externalCalls += 1; },
    readRaw: async () => { externalCalls += 1; return []; },
    writeReconciliation: async () => { externalCalls += 1; }
  });
  const req = { method: 'POST', headers: { 'x-vector-key': 'wrong' }, body: { month: '2026-08' } };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { ok: false, error: 'forbidden' });
  assert.equal(externalCalls, 0);
});

test('sync-hours rejects an invalid month before external calls', async () => {
  let externalCalls = 0;
  const handler = createSyncHoursHandler({
    configuredKey: 'secret',
    fetchReport: async () => { externalCalls += 1; return REPORT_ROWS; },
    writeRaw: async () => { externalCalls += 1; },
    readRaw: async () => { externalCalls += 1; return []; },
    writeReconciliation: async () => { externalCalls += 1; }
  });
  const req = { method: 'POST', headers: { 'x-vector-key': 'secret' }, body: { month: '2026-13' } };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { ok: false, error: 'month must be a valid YYYY-MM value' });
  assert.equal(externalCalls, 0);
});

test('sync-hours writes staging, verifies read-back, and omits personal data from response', async () => {
  let writtenRaw;
  let writtenReconciliation;
  const handler = createSyncHoursHandler({
    configuredKey: 'secret',
    now: () => new Date('2026-08-31T10:00:00.000Z'),
    fetchReport: async (month) => {
      assert.equal(month, '2026-08');
      return REPORT_ROWS;
    },
    writeRaw: async (values) => { writtenRaw = values; },
    readRaw: async () => writtenRaw,
    writeReconciliation: async (values) => { writtenReconciliation = values; }
  });
  const req = { method: 'POST', headers: { 'x-vector-key': 'secret' }, body: { month: '2026-08' } };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.mode, 'staging_only');
  assert.deepEqual(res.body.source, { rows: 1, hours: 3, duplicateRows: 0 });
  assert.deepEqual(res.body.staging, { rows: 1, hours: 3 });
  assert.deepEqual(res.body.comparison, { ok: true, rowDiff: 0, hoursDiff: 0 });
  assert.equal(JSON.stringify(res.body).includes('Иванов'), false);
  assert.equal(writtenReconciliation.at(-1)[0], 'verification');
  assert.equal(writtenReconciliation.at(-1)[1], 'OK');
});

test('sync-hours returns 502 when Google read-back does not match ASHK', async () => {
  let writtenReconciliation;
  const handler = createSyncHoursHandler({
    configuredKey: 'secret',
    now: () => new Date('2026-08-31T10:00:00.000Z'),
    fetchReport: async () => REPORT_ROWS,
    writeRaw: async () => {},
    readRaw: async () => [['Key', 'Month', 'FactDate', 'FactStart', 'EmployeeId', 'MasterName', 'ContractName', 'SessionTypeName', 'Hours']],
    writeReconciliation: async (values) => { writtenReconciliation = values; }
  });
  const req = { method: 'POST', headers: { authorization: 'Bearer secret' }, body: { month: '2026-08' } };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Staging verification failed');
  assert.deepEqual(res.body.comparison, { ok: false, rowDiff: -1, hoursDiff: -3 });
  assert.equal(writtenReconciliation.at(-1)[1], 'ERROR');
});
