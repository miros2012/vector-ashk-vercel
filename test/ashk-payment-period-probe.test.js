import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPaymentRecordDebitListHints,
  probeAshkPaymentRecordDebitListHints
} from '../lib/ashk-payment-period-probe.js';

test('extracts bounded query/filter context around PaymentRecordDebitList without unrelated modules', () => {
  const source = `
    define("before",[],function(){ return { secret:"ignore" }; }),
    define("views/payment/list",[],function(){
      var cfg={command:"PaymentRecordDebitList",queryParams:function(){
        var p=this.getTopParentView();
        return {Period:p.getValue(),DateFrom:"2026-09-01",DateTo:"2026-09-16",HideRefunds:false};
      }};
      return cfg;
    }),
    define("after",[],function(){ return "ignore-after"; });
  `;
  const result = extractPaymentRecordDebitListHints(source);
  assert.equal(result.found, true);
  assert.deepEqual(result.candidateKeys, ['DateFrom','DateTo','HideRefunds','Period']);
  assert.match(result.context, /PaymentRecordDebitList/);
  assert.doesNotMatch(result.context, /ignore-after/);
  assert.ok(result.context.length <= 5000);
});

test('returns an empty safe diagnostic when payment command is absent', () => {
  assert.deepEqual(extractPaymentRecordDebitListHints('define("x",[],function(){})'), {
    found: false,
    candidateKeys: [],
    context: ''
  });
});

test('scans authenticated internal javascript assets until PaymentRecordDebitList is found', async () => {
  const calls = [];
  const session = {
    requestText: async path => {
      calls.push(path);
      if (path === '/') return '<script src="/a.js"></script><script src="/b.js"></script>';
      if (path === '/a.js') return 'define("x",[],function(){})';
      if (path === '/b.js') return 'define("payments",[],function(){return {command:"PaymentRecordDebitList",queryParams:function(){return {PayDateFrom:1,PayDateTo:2}}}})';
      throw new Error('unexpected');
    }
  };
  const result = await probeAshkPaymentRecordDebitListHints({ session });
  assert.deepEqual(calls, ['/', '/a.js', '/b.js']);
  assert.equal(result.asset, '/b.js');
  assert.deepEqual(result.candidateKeys, ['PayDateFrom','PayDateTo']);
  assert.equal(result.found, true);
});
