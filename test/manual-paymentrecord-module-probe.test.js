import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualFinanceRunHandler } from '../lib/manual-finance-run-handler.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {}
  };
}

test('payment-record-module probe consumes token, returns compact contract and skips payment sync', async () => {
  const events = [];
  const handler = createManualFinanceRunHandler({
    cronSecret: 'cron-secret',
    consumeToken: async () => ({ ok: true, reason: 'consumed' }),
    runNightly: async () => { events.push('nightly'); },
    runPayments: async () => { events.push('payments'); },
    runPaymentRecordModuleProbe: async () => {
      events.push('module-probe');
      return {
        asset: '/app.js',
        found: true,
        command: 'PaymentRecordDebitList',
        queryKeys: ['Filter','count','start'],
        usesGetValues: true,
        context: 'queryParams function Filter'
      };
    }
  });
  const res = responseRecorder();

  await handler({
    method: 'GET',
    headers: {},
    query: { finance_run_token: 'single-use', stage: 'payments', probe: 'payment-record-module' },
    url: '/api/nightly-finance-orchestrator?finance_run_token=single-use&stage=payments&probe=payment-record-module'
  }, res);

  assert.deepEqual(events, ['module-probe']);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.probe, 'payment-record-module');
  assert.equal(res.body.result.command, 'PaymentRecordDebitList');
});
