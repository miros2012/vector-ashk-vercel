import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractReportPanelActions,
  probeAshkReportPanelActions
} from '../lib/ashk-reportpanel-action-probe.js';

test('extracts server actions and api paths used near reportpanel implementation', () => {
  const source = `
    webix.protoUI({ name:"reportpanel", $init:function(){
      Dsc.server.action("ReportTemplateGet", { TemplateName:this.config.templateName });
      return Dsc.server.get('/api/ReportDataList?token=secret');
    }});
  `;
  const result = extractReportPanelActions(source);
  assert.deepEqual(result.actions, ['ReportTemplateGet']);
  assert.deepEqual(result.apiPaths, ['/api/ReportDataList']);
  assert.ok(result.contexts.some(item => /reportpanel/.test(item)));
  assert.ok(result.contexts.every(item => !item.includes('secret')));
});

test('scans authenticated app assets for reportpanel implementation actions', async () => {
  const session = {
    requestText: async path => {
      if (path === '/') return '<script src="/content/deploy/app.js"></script>';
      if (path === '/content/deploy/app.js') return 'name:"reportpanel";Dsc.server.action("ReportBuild",{});';
      throw new Error(`unexpected ${path}`);
    }
  };
  const result = await probeAshkReportPanelActions({ session });
  assert.equal(result.assetCount, 1);
  assert.deepEqual(result.actions, ['ReportBuild']);
});
