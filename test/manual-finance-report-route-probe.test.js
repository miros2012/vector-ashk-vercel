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

test('report-routes probe consumes token, returns candidates, and does not run payment sync', async () => {
  const events = [];
  const handler = createManualFinanceRunHandler({
    cronSecret: 'cron-secret',
    consumeToken: async () => { events.push('consume'); return { ok: true, reason: 'consumed' }; },
    runNightly: async () => { events.push('nightly'); },
    runPayments: async () => { events.push('payments'); },
    runReportRouteProbe: async () => {
      events.push('report-routes');
      return [{ href: '/Reports/EmployeeActivity', text: 'Активность сотрудников' }];
    }
  });
  const res = responseRecorder();

  await handler({
    method: 'GET',
    headers: {},
    query: { finance_run_token: 'single-use', stage: 'payments', probe: 'report-routes' },
    url: '/api/nightly-finance-orchestrator?finance_run_token=single-use&stage=payments&probe=report-routes'
  }, res);

  assert.deepEqual(events, ['consume', 'report-routes']);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    probe: 'report-routes',
    candidates: [{ href: '/Reports/EmployeeActivity', text: 'Активность сотрудников' }]
  });
});
