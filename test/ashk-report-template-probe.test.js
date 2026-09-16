import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractReportPanels,
  probeAshkReportTemplates
} from '../lib/ashk-report-template-probe.js';

test('extracts reportpanel template names and nearby titles from minified javascript', () => {
  const source = `
    define("views/reports/admin",[],function(){
      var a={view:"reportpanel",templateName:"_SYSADMINKPI",title:"Продажи по сотрудникам",ref:"reportview"};
      var b={view:"reportpanel",templateName:"_SYSEMPACTIVITY",title:"Активность сотрудников",ref:"reportview2"};
    });
  `;
  assert.deepEqual(extractReportPanels(source), [
    { templateName: '_SYSADMINKPI', title: 'Продажи по сотрудникам' },
    { templateName: '_SYSEMPACTIVITY', title: 'Активность сотрудников' }
  ]);
});

test('scans authenticated internal assets and deduplicates report templates', async () => {
  const session = {
    requestText: async path => {
      if (path === '/') return '<script src="/content/deploy/app.js?v=1"></script><script src="/other.js"></script>';
      if (path === '/content/deploy/app.js') return '{view:"reportpanel",templateName:"_SYSADMINKPI",title:"Продажи по сотрудникам"}';
      if (path === '/other.js') return '{view:"reportpanel",templateName:"_SYSADMINKPI",title:"Продажи по сотрудникам"}';
      throw new Error(`unexpected ${path}`);
    }
  };
  const result = await probeAshkReportTemplates({ session });
  assert.equal(result.assetCount, 2);
  assert.deepEqual(result.templates, [
    { templateName: '_SYSADMINKPI', title: 'Продажи по сотрудникам' }
  ]);
});
