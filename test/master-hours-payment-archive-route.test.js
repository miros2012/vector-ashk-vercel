import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasterHoursDiagnosticHandler } from '../api/master-hours-diagnostic.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = Number(code); return this; },
    json(body) { this.body = body; return this; }
  };
}

test('master-hours diagnostic multiplexes archive POST without invoking finance or GET work', async () => {
  const calls = [];
  const handler = createMasterHoursDiagnosticHandler({
    financeSyncHandler: async (_req, res) => {
      calls.push('finance');
      return res.status(200).json({ ok: true });
    },
    paymentArchiveHandler: async (_req, res) => {
      calls.push('archive');
      return res.status(200).json({ ok: true, mode: 'read_only_payment_archive' });
    },
    runMasterHoursReport: async () => {
      calls.push('master-hours');
      return {};
    }
  });
  const res = responseRecorder();
  await handler({
    method: 'POST',
    headers: {},
    body: { mode: 'payment_archive', startDate: '2026-09-01', endDate: '2026-09-30' }
  }, res);

  assert.deepEqual(calls, ['archive']);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'read_only_payment_archive');
});
