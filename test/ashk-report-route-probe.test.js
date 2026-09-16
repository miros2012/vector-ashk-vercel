import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAshkAssetPaths,
  extractAshkReportRouteCandidates,
  extractAshkRouteStrings,
  probeAshkReportRoutes
} from '../lib/ashk-report-route-probe.js';

test('extracts only report and finance links and strips query strings', () => {
  const html = `
    <nav>
      <a href="/Student/List">Курсанты</a>
      <a href="/Reports/EmployeeActivity?school=secret">Активность сотрудников</a>
      <a href="/Finance/Payments?from=2026-09-01">Внесенные оплаты</a>
      <a href="javascript:void(0)">Отчеты</a>
    </nav>`;

  assert.deepEqual(extractAshkReportRouteCandidates(html), [
    { href: '/Reports/EmployeeActivity', text: 'Активность сотрудников' },
    { href: '/Finance/Payments', text: 'Внесенные оплаты' }
  ]);
});

test('extracts only internal js resources and strips query strings', () => {
  const html = `
    <script src="/dist/app.js?v=secret"></script>
    <script src="https://app.dscontrol.ru/js/reports.js?hash=abc"></script>
    <script src="https://cdn.example.com/foreign.js"></script>
    <link rel="stylesheet" href="/css/site.css?v=1">
  `;
  assert.deepEqual(extractAshkAssetPaths(html), [
    '/dist/app.js',
    '/js/reports.js'
  ]);
});

test('extracts safe report-like internal route strings from inline html or javascript', () => {
  const source = `
    window.menu = { employee: '/Reports/EmployeeActivity?school=secret' };
    const payments = "/Finance/Payments#today";
    const student = '/Student/List';
    const external = 'https://other.example.com/Reports/Leak';
  `;
  assert.deepEqual(extractAshkRouteStrings(source), [
    '/Reports/EmployeeActivity',
    '/Finance/Payments'
  ]);
});

test('discovers report routes from authenticated page and internal javascript assets', async () => {
  const calls = [];
  const session = {
    requestText: async path => {
      calls.push(path);
      if (path === '/') {
        return '<script src="/dist/app.js?v=1"></script><a href="/Finance/Payments">Оплаты</a>';
      }
      assert.equal(path, '/dist/app.js');
      return 'const employeeActivity = "/Reports/EmployeeActivity?tenant=private";';
    }
  };

  const result = await probeAshkReportRoutes({ session });

  assert.deepEqual(calls, ['/', '/dist/app.js']);
  assert.deepEqual(result, [
    { href: '/Finance/Payments', text: 'Оплаты' },
    { href: '/Reports/EmployeeActivity', text: '' }
  ]);
});
