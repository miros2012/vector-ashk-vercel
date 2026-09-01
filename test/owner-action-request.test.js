import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOwnerActionRequest, processOwnerActionRequest } from '../lib/owner-action-request.js';

const base={ruleId:'DEC-CRIT-DUE',expectedExecutionStatus:'Не начато',verificationStatus:'Не проверено',requestedAction:'В работу',result:'',evidence:'',actualEffect:'',currentRequest:'',processedRequestId:'',transportStatus:''};

test('maps sheet actions to decision commands with stable request id',()=>{
  const a=normalizeOwnerActionRequest(base);
  const b=normalizeOwnerActionRequest(base);
  assert.equal(a.command.action,'start');
  assert.equal(a.command.expectedExecutionStatus,'Не начато');
  assert.equal(a.command.actor,'Собственник');
  assert.equal(a.requestId,b.requestId);
  assert.match(a.requestId,/^sheet-/);

  const verify=normalizeOwnerActionRequest({...base,expectedExecutionStatus:'Готово',requestedAction:'Подтвердить эффект',actualEffect:125000});
  assert.equal(verify.command.action,'verify');
  assert.equal(verify.command.verificationStatus,'Подтверждено');
  assert.equal(verify.command.actualEffect,125000);
});

test('claims READY-like request before execution and marks success',async()=>{
  const calls=[];
  const result=await processOwnerActionRequest({
    readControl:async()=>base,
    claimRequest:async(id)=>calls.push(['claim',id]),
    executeCommand:async(command)=>{calls.push(['execute',command.requestId]); return {ok:true,executionStatus:'В работе'};},
    markSuccess:async(id)=>calls.push(['success',id]),
    markError:async()=>{},
    now:()=>new Date('2026-09-01T13:40:00Z')
  });
  assert.equal(result.processed,true);
  assert.equal(calls[0][0],'claim');
  assert.equal(calls[1][0],'execute');
  assert.equal(calls[2][0],'success');
});

test('already processed request is ignored',async()=>{
  const normalized=normalizeOwnerActionRequest(base);
  let executions=0;
  const result=await processOwnerActionRequest({
    readControl:async()=>({...base,processedRequestId:normalized.requestId,transportStatus:'SUCCESS'}),
    claimRequest:async()=>{}, executeCommand:async()=>{executions++;}, markSuccess:async()=>{}, markError:async()=>{}
  });
  assert.equal(result.processed,false);
  assert.equal(executions,0);
});

test('execution error is recorded without throwing to caller',async()=>{
  let marked='';
  const result=await processOwnerActionRequest({
    readControl:async()=>base, claimRequest:async()=>{}, executeCommand:async()=>{throw new Error('stale execution state');},
    markSuccess:async()=>{}, markError:async(_id,message)=>{marked=message;}
  });
  assert.equal(result.ok,false);
  assert.match(marked,/stale/);
});
