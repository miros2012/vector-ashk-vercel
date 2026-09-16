import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAshkTemplateModelHints } from '../lib/ashk-template-model-probe.js';

test('extracts only bounded template-model commands and paths from minified javascript', () => {
  const source = `
    define("before",[],function(){return "IgnoreMe"}),
    define("models/templates",["models/api"],function(e){
      var t=e.query("DocTemplateList");
      function get(){return Dsc.server.action("DocTemplateGet",{x:1})}
      var p="/api/DocTemplateList?tenant=secret";
      var g="/apia/DocInstanceGen";
      return {getByName:function(){},t:t};
    }),
    define("after",[],function(){return Dsc.server.action("IgnoreAfter")});
  `;

  assert.deepEqual(extractAshkTemplateModelHints(source), {
    moduleFound: true,
    commands: ['DocTemplateGet', 'DocTemplateList'],
    paths: ['/api/DocTemplateList', '/apia/DocInstanceGen']
  });
});

test('fails closed to an empty diagnostic when models/templates is absent', () => {
  assert.deepEqual(extractAshkTemplateModelHints('define("x",[],function(){})'), {
    moduleFound: false,
    commands: [],
    paths: []
  });
});
