import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerActionRequestRunner } from '../lib/owner-action-request-runner.js';

function current(){ return {ruleId:'DEC-1',ruleStatus:'Активно',executionStatus:'Не начато',verificationStatus:'Не проверено',plannedEffect:1000,actualEffect:null,startedAt:null,completedAt:null,result:'',lastCheckedAt:null}; }

test('runner delegates a sheet request through the shared decision command core', async()=>{
  const writes=[]; const events=[]; const transport=[];
  const runner=createOwnerActionRequestRunner({
    requestAdapter:{
      readControl:async()=>({ruleId:'DEC-1',expectedExecutionStatus:'Не начато',requestedAction:'В работу',processedRequestId:'',transportStatus:''}),
      claimRequest:async(id)=>transport.push(['claim',id]),
      markSuccess:async(id)=>transport.push(['success',id]),
      markError:async(id,msg)=>transport.push(['error',id,msg])
    },
    decisionAdapter:{
      getDecision:async()=>current(), hasEvent:async()=>false,
      writeDecision:async(id,next)=>writes.push([id,next.executionStatus]), appendEvent:async(e)=>events.push(e)
    },
    now:()=>new Date('2026-09-01T13:50:00Z')
  });
  const result=await runner();
  assert.equal(result.ok,true);
  assert.equal(result.processed,true);
  assert.equal(writes[0][1],'В работе');
  assert.equal(events.length,1);
  assert.equal(transport[0][0],'claim');
  assert.equal(transport.at(-1)[0],'success');
});
