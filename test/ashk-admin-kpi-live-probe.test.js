import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAlinaReportSnippet,
  findTemplateId,
  probeAshkAdminKpiReports
} from '../lib/ashk-admin-kpi-live-probe.js';

test('finds _SYSADMINKPI template id from template list payload', () => {
  assert.equal(findTemplateId([
    { Id: 7, Name: '_OTHER' },
    { Id: 42, Name: '_SYSADMINKPI' }
  ], '_SYSADMINKPI'), 42);
  assert.equal(findTemplateId({ data: [{ Id: '99', Name: '_SYSADMINKPI' }] }, '_SYSADMINKPI'), '99');
  assert.equal(findTemplateId({ data: [] }, '_SYSADMINKPI'), '');
});

test('extracts only bounded Alina context from generated report html', () => {
  const html = '<table><tr><td>Другой сотрудник</td><td>999999</td></tr><tr><td>Кумаритова Алина</td><td>163 150</td><td>325 950</td></tr></table>';
  const snippet = extractAlinaReportSnippet(html);
  assert.match(snippet, /Кумаритова Алина/);
  assert.match(snippet, /163 150/);
  assert.ok(snippet.length <= 600);
  assert.equal(snippet.includes('Другой сотрудник'), false);
});

test('probes all admin KPI date modes with explicit custom September period', async () => {
  const calls = [];
  const session = {
    requestJson: async (path) => {
      assert.equal(path, '/api/templatelist');
      return [{ Id: 42, Name: '_SYSADMINKPI' }];
    },
    requestText: async (path, params) => {
      calls.push({ path, params });
      assert.equal(path, '/apia/DocInstanceGen');
      return `<div>Кумаритова Алина ${params.Data.includes('ByFirstPayDate') ? '163 150' : '111 000'}</div>`;
    }
  };

  const result = await probeAshkAdminKpiReports({
    session,
    startDate: '01.09.2026',
    endDate: '16.09.2026'
  });

  assert.equal(result.templateId, 42);
  assert.deepEqual(result.reports.map(item => item.mode), [
    'BySaleDate','ByRegDate','ByContractDate','ByFirstPayDate','ByAnyDate'
  ]);
  assert.equal(result.reports.find(item => item.mode === 'ByFirstPayDate').alinaSnippet.includes('163 150'), true);
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.params.TemplateId, 42);
    const data = JSON.parse(call.params.Data);
    assert.equal(data.Period, 'Custom');
    assert.equal(data.StartDate, '01.09.2026');
    assert.equal(data.EndDate, '16.09.2026');
  }
});
