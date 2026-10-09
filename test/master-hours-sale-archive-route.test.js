import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasterHoursDiagnosticHandler } from '../api/master-hours-diagnostic.js';

test('master-hours diagnostic multiplexes sale archive without invoking finance, payment archive or GET work', async () => {
  const calls = [];
  const res = {
    statusCode: 200, body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  const handler = createMasterHoursDiagnosticHandler({
    financeSyncHandler: async () => calls.push('finance'),
    paymentArchiveHandler: async () => calls.push('payment'),
    saleArchiveHandler: async (_req, response) => {
      calls.push('sale');
      return response.status(200).json({ ok: true, mode: 'read_only_sale_archive' });
    },
    runMasterHoursReport: async () => calls.push('hours')
  });
  await handler({ method: 'POST', body: { mode: 'sale_archive' }, headers: {} }, res);
  assert.deepEqual(calls, ['sale']);
  assert.equal(res.body.mode, 'read_only_sale_archive');
});
