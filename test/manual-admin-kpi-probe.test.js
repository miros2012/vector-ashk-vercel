import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualFinanceRunHandler } from '../lib/manual-finance-run-handler.js';

function res() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('admin KPI report probe consumes token and returns report diagnostic without running payment sync', async () => {
  const events = [];
  const handler = createManualFinanceRunHandler({
    cronSecret: 'cron-secret',
    consumeToken: async () => ({ ok: true }),
    runNightly: async () => { events.push('nightly'); },
    runPayments: async () => { events.push('payments'); },
    runAdminKpiProbe: async () => {
      events.push('admin-kpi');
      return { templateId: 42, reports: [{ mode: 'ByAnyDate', alinaSnippet: 'Кумаритова Алина 163 150' }] };
    }
  });
  const response = res();
  await handler({
    method: 'GET',
    headers: {},
    query: { finance_run_token: 'once', stage: 'payments', probe: 'admin-kpi-report' },
    url: '/api/nightly-finance-orchestrator?finance_run_token=once&stage=payments&probe=admin-kpi-report'
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(events, ['admin-kpi']);
  assert.equal(response.body.probe, 'admin-kpi-report');
  assert.match(JSON.stringify(response.body.result), /163 150/);
});
