import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDefinedModule,
  extractAdminKpiReportConfig,
  probeAshkAdminKpiModule
} from '../lib/ashk-adminkpi-module-probe.js';

test('extracts one named AMD module without bleeding into the next module', () => {
  const source = 'define("before",[],function(){return 1}),define("views/reports/adminkpi",[],function(){var x="ADMINKPI";return x}),define("after",[],function(){return 2})';
  const moduleText = extractDefinedModule(source, 'views/reports/adminkpi');
  assert.match(moduleText, /ADMINKPI/);
  assert.doesNotMatch(moduleText, /before/);
  assert.doesNotMatch(moduleText, /after/);
});

test('extracts report template and loadWith parameter names from admin KPI module', () => {
  const source = `define("views/reports/adminkpi",[],function(){
    click:function(){
      var mode=webix.findBy(root,"mode").getValue();
      var period=webix.findBy(root,"period").getValue();
      var startDate=webix.findBy(root,"startDate").getValue();
      var endDate=webix.findBy(root,"endDate").getValue();
      webix.findBy(root,"reportview").loadWith({Mode:mode,Period:period,StartDate:startDate,EndDate:endDate});
    },
    view:"reportpanel",templateName:"_SYSADMINKPI",title:"Продажи по сотрудникам"
  }),define("after",[],function(){})`;
  const result = extractAdminKpiReportConfig(source);
  assert.equal(result.templateName, '_SYSADMINKPI');
  assert.deepEqual(result.refs, ['endDate','mode','period','reportview','startDate']);
  assert.deepEqual(result.dataKeys, ['EndDate','Mode','Period','StartDate']);
  assert.match(result.context, /loadWith/);
});

test('scans authenticated assets and returns only the admin KPI module diagnostic', async () => {
  const session = {
    requestText: async path => {
      if (path === '/') return '<script src="/app.js"></script>';
      if (path === '/app.js') return 'define("views/reports/adminkpi",[],function(){return {view:"reportpanel",templateName:"_SYSADMINKPI"}}),define("after",[],function(){})';
      throw new Error(`unexpected ${path}`);
    }
  };
  const result = await probeAshkAdminKpiModule({ session });
  assert.equal(result.asset, '/app.js');
  assert.equal(result.templateName, '_SYSADMINKPI');
  assert.ok(result.context.length > 0);
});
