import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerActionRequestProcessor } from '../lib/owner-action-request-service.js';

test('processes one pending action through existing execution command and marks success', async () => {
  const calls=[];
  const pending={ command:{ ruleId:'DEC-1', action:'start', requestId:'OAR-1', expectedExecutionStatus:'Не начато' } };
  const processor=createOwnerActionRequestProcessor({
    readPending:async()=>pending,
    markSent:async(id)=>calls.push(['sent',id]),
    executeCommand:async(command)=>({ status:200, body:{ ok:true, requestId:command.requestId, executionStatus:'В работе' } }),
    markSuccess:async(id,body)=>calls.push(['success',id,body.executionStatus]),
    markError:async()=>calls.push(['error'])
  });
  const result=await processor();
  assert.equal(result.processed,true);
  assert.equal(result.ok,true);
  assert.deepEqual(calls,[['sent','OAR-1'],['success','OAR-1','В работе']]);
});

test('does nothing when there is no pending request', async () => {
  const processor=createOwnerActionRequestProcessor({
    readPending:async()=>null,
    markSent:async()=>{}, executeCommand:async()=>{}, markSuccess:async()=>{}, markError:async()=>{}
  });
  assert.deepEqual(await processor(),{ processed:false, ok:true });
});

test('terminal client errors are recorded and consumed while server errors remain retryable', async () => {
  const errors=[];
  const make=(status)=>createOwnerActionRequestProcessor({
    readPending:async()=>({ command:{ ruleId:'DEC-1', requestId:'OAR-X' } }),
    markSent:async()=>{},
    executeCommand:async()=>({ status, body:{ ok:false, error:'boom' } }),
    markSuccess:async()=>{},
    markError:async(id,message,options)=>errors.push([status,id,message,options.consume])
  });
  assert.equal((await make(409)()).ok,false);
  assert.equal((await make(500)()).ok,false);
  assert.deepEqual(errors,[[409,'OAR-X','boom',true],[500,'OAR-X','boom',false]]);
});
