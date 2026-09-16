import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAshkReportKeywordHints,
  probeAshkReportKeywordHints
} from '../lib/ashk-report-keyword-probe.js';

test('extracts bounded staff/payment report hints from javascript without unrelated text', () => {
  const source = `
    const x = 'unrelated';
    function loadEmployeeActivityReport(){ return api('/api/EmployeeActivityList?tenant=secret'); }
    const title = 'Активность сотрудников';
    const payments = '/api/PaymentsByEmployee';
  `;
  const hints = extractAshkReportKeywordHints(source, { contextRadius: 90, maxMatches: 10 });
  assert.ok(hints.some(item => /EmployeeActivityReport/.test(item.context)));
  assert.ok(hints.some(item => /Активность сотрудников/.test(item.context)));
  assert.ok(hints.some(item => /PaymentsByEmployee/.test(item.context)));
  assert.ok(hints.every(item => item.context.length <= 220));
  assert.ok(hints.every(item => !item.context.includes('tenant=secret')));
});

test('scans authenticated root and internal javascript assets for report hints', async () => {
  const calls = [];
  const session = {
    requestText: async path => {
      calls.push(path);
      if (path === '/') {
        return '<script src="/dist/app.js?v=1"></script><script src="/dist/reports.js"></script>';
      }
      if (path === '/dist/app.js') return 'const noop = true;';
      if (path === '/dist/reports.js') return 'const route = "/api/EmployeeActivityList";';
      throw new Error(`unexpected ${path}`);
    }
  };
  const result = await probeAshkReportKeywordHints({ session, maxAssets: 5 });
  assert.deepEqual(calls, ['/', '/dist/app.js', '/dist/reports.js']);
  assert.equal(result.assetCount, 2);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].asset, '/dist/reports.js');
  assert.match(result.matches[0].context, /EmployeeActivityList/);
});
