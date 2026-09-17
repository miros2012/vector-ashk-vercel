import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractNamedAmdModule,
  extractAdminKpiDefinitionHints
} from '../lib/ashk-adminkpi-definition-probe.js';

test('extracts exact named AMD module without spilling into the next module', () => {
  const source = 'define("views/reports/adminkpi",["models/api"],function(e){var x={templateName:"_SYSADMINKPI"};return x}),define("views/reports/admin",[],function(){return 1})';
  const moduleText = extractNamedAmdModule(source, 'views/reports/adminkpi');
  assert.match(moduleText, /_SYSADMINKPI/);
  assert.doesNotMatch(moduleText, /views\/reports\/admin"/);
});

test('extracts admin KPI input ids, option ids, template name and reportpanel endpoint hints', () => {
  const source = `
    define("views/reports/adminkpi",["models/api","lib/reportpanel"],function(e){
      var x={rows:[{view:"select",ref:"mode",options:[{id:"BySaleDate"},{id:"ByFirstPayDate"}]},
      {view:"select",ref:"period",options:[{id:"Month"},{id:"Custom"}]},
      {view:"datepicker",ref:"startDate"},{view:"datepicker",ref:"endDate"},
      {view:"reportpanel",templateName:"_SYSADMINKPI",title:"Продажи по сотрудникам",ref:"reportview"}]};
      function run(){var r={Mode:"ByFirstPayDate",Period:"Month",StartDate:"2026-09-01",EndDate:"2026-09-30"}; report.loadWith(r)}
      return {$ui:x};
    }),
    define("models/templates",[],function(){ var endpoint="/api/TemplateList"; return {getByName:function(name){}}; })
  `;
  const hints = extractAdminKpiDefinitionHints(source);
  assert.equal(hints.templateName, '_SYSADMINKPI');
  assert.equal(hints.title, 'Продажи по сотрудникам');
  assert.deepEqual(hints.refs.sort(), ['endDate','mode','period','reportview','startDate']);
  assert.deepEqual(hints.optionIds.sort(), ['ByFirstPayDate','BySaleDate','Custom','Month']);
  assert.match(hints.moduleContext, /loadWith/);
});
