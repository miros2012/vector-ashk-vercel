import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPaymentRecordModuleHints } from '../lib/ashk-paymentrecord-module-probe.js';

test('extracts PaymentRecordDebitList query/filter contract from the named list module', () => {
  const source = `
    define("views/paymentrecord/list",["models/api"],function(e){
      var page=(new Dsc.crudpage).build({listUI:{view:"querytable",command:"PaymentRecordDebitList",queryParams:function(){
        var f=webix.findBy(this,"filter").getValues();
        return {Filter:webix.ajax.prototype.stringify(f),start:0,count:200};
      }}});
      return {$ui:page};
    }),
    define("views/paymentrecord/filter",[],function(){return {rows:[{name:"ContractDateFrom"},{name:"EntryDateFrom"}]}})
  `;

  const result = extractPaymentRecordModuleHints(source);
  assert.equal(result.found, true);
  assert.equal(result.command, 'PaymentRecordDebitList');
  assert.deepEqual(result.queryKeys.sort(), ['Filter','count','start']);
  assert.equal(result.usesGetValues, true);
  assert.match(result.context, /PaymentRecordDebitList/);
  assert.match(result.context, /Filter/);
});
