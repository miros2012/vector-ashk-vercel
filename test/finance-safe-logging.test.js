import test from 'node:test';
import assert from 'node:assert/strict';
import { createNightlyFinanceOrchestrator } from '../lib/nightly-finance-orchestrator.js';
import { createIntradayRopOrchestrator } from '../lib/rop-intraday-orchestrator.js';
import { createReceivablesSyncHandler } from '../lib/receivables-sync-handler.js';
import { createManualFinanceRunHandler } from '../lib/manual-finance-run-handler.js';

const success = async (_req, res) => res.status(200).json({ ok: true });
function response() { return { status() { return this; }, json(body) { this.body = body; return this; } }; }
function capture(t) {
  const logs = [];
  for (const method of ['log', 'error']) t.mock.method(console, method, (...args) => logs.push(args));
  return logs;
}
function safeLogs(logs) {
  for (const args of logs) {
    assert.equal(args.length, 1);
    assert.equal(typeof args[0], 'object');
    assert.ok(Object.keys(args[0]).every(key => ['stage', 'errorClass', 'attempt', 'retryable'].includes(key)));
  }
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_STUDENT|PRIVATE_ERROR/);
}

for (const [mode, factory] of [['nightly', createNightlyFinanceOrchestrator], ['intraday', createIntradayRopOrchestrator]]) {
  test(`${mode} never logs or returns arbitrary child exception text`, async t => {
    const logs = capture(t);
    const handler = factory({
      cronSecret: 'test', runHours: success, runPayments: success,
      runReceivablesSource: async () => { throw Object.assign(new Error('PRIVATE_STUDENT'), { name: 'PRIVATE_ERROR' }); },
      runRopPublish: async () => ({ ok: true }), runDataHealth: success, runDecisions: success,
      runOwnerActionQueue: async () => ({ ok: true })
    });
    const res = response();
    await handler({ method: 'GET', headers: { authorization: 'Bearer test' } }, res);
    safeLogs(logs);
    assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE_STUDENT|PRIVATE_ERROR/);
  });
}

test('intraday outer failure logs only allowed stage metadata', async t => {
  const logs = capture(t);
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'test', runPayments: success, refreshRop: async () => { throw new Error('PRIVATE_STUDENT'); },
    runDataHealth: success, runDecisions: success, runOwnerActionQueue: async () => ({ ok: true })
  });
  await handler({ method: 'GET', headers: { authorization: 'Bearer test' } }, response());
  safeLogs(logs);
});

test('receivables success does not log financial payload or aggregate values', async t => {
  const logs = capture(t);
  let detail, summary;
  const handler = createReceivablesSyncHandler({
    fetchCurrent: async () => ({ groups: [], contractsByGroup: new Map() }),
    writeDetail: async values => { detail = values; }, writeSummary: async values => { summary = values; },
    readDetail: async () => detail, readSummary: async () => summary
  });
  await handler({ method: 'GET' }, response());
  safeLogs(logs);
});

test('manual token failures and payment probes log no arbitrary exception names or probe payloads', async t => {
  const logs = capture(t);
  const unsafeFailure = async () => { throw Object.assign(new Error('PRIVATE_STUDENT'), { name: 'PRIVATE_ERROR' }); };
  const makeHandler = overrides => createManualFinanceRunHandler({
    cronSecret: 'test', consumeToken: async () => ({ ok: true }), runNightly: success, runPayments: success,
    ...overrides
  });
  await makeHandler({ consumeToken: unsafeFailure })({ method: 'GET', query: { finance_run_token: 'token' } }, response());
  for (const [probe, dependency] of [
    ['payment-record-module', 'runPaymentRecordModuleProbe'], ['admin-kpi-report', 'runAdminKpiProbe'],
    ['report-routes', 'runReportRouteProbe'], ['report-keywords', 'runReportKeywordProbe'],
    ['payment-report', 'runPaymentProbe']
  ]) {
    for (const execute of [unsafeFailure, async () => ({ result: 'PRIVATE_STUDENT' })]) {
      await makeHandler({ [dependency]: execute })({ method: 'GET', query: { finance_run_token: 'token', stage: 'payments', probe } }, response());
    }
  }
  safeLogs(logs);
});
