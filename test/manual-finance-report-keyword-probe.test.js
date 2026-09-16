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

test('report keyword probe consumes token and returns diagnostic without running payment sync', async () => {
  const events = [];
  const handler = createManualFinanceRunHandler({
    cronSecret: 'cron-secret',
    consumeToken: async () => ({ ok: true }),
    runNightly: async () => { events.push('nightly'); },
    runPayments: async () => { events.push('payments'); },
    runReportKeywordProbe: async () => {
      events.push('keyword-probe');
      return { assetCount: 1, matches: [{ asset: '/app.js', keyword: 'EmployeeActivity', context: 'EmployeeActivityReport' }] };
    }
  });
  const res = responseRecorder();
  await handler({
    method: 'GET',
    headers: {},
    query: { finance_run_token: 'one-time', stage: 'payments', probe: 'report-keywords' },
    url: '/api/nightly-finance-orchestrator?finance_run_token=one-time&stage=payments&probe=report-keywords'
  }, res);

  assert.deepEqual(events, ['keyword-probe']);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.probe, 'report-keywords');
  assert.equal(res.body.result.assetCount, 1);
});
