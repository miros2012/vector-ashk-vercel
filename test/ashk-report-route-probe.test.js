import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAshkReportRouteCandidates } from '../lib/ashk-report-route-probe.js';

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
