import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerActionApi } from '../lib/owner-action-api.js';

function resRecorder() {
  return { code:null, body:null, headers:{}, setHeader(k,v){this.headers[k]=v;}, status(c){this.code=c; return this;}, json(b){this.body=b; return this;} };
}

test('rejects unauthorized request before sheet read', async () => {
  let reads = 0;
  const handler = createOwnerActionApi({ configuredKey:'secret', readOwnerAction: async()=>{reads++; return {top:null,activeCount:0};} });
  const res = resRecorder();
  await handler({ method:'GET', headers:{} }, res);
  assert.equal(res.code, 403);
  assert.equal(reads, 0);
});

test('GET returns normalized owner action with no-store', async () => {
  const handler = createOwnerActionApi({ configuredKey:'secret', now:()=>new Date('2026-09-01T13:30:00Z'), readOwnerAction: async()=>({ activeCount:1, top:{ ruleId:'DEC-1', allowedActions:['start'] } }) });
  const res = resRecorder();
  await handler({ method:'GET', headers:{'x-vector-key':'secret'} }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.top.ruleId, 'DEC-1');
  assert.equal(res.body.checkedAt, '2026-09-01T13:30:00.000Z');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('POST is rejected with 405', async () => {
  const handler = createOwnerActionApi({ configuredKey:'secret', readOwnerAction: async()=>({top:null,activeCount:0}) });
  const res = resRecorder();
  await handler({ method:'POST', headers:{'x-vector-key':'secret'} }, res);
  assert.equal(res.code, 405);
});
