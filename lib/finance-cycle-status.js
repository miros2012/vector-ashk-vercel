import { validFinanceCycle, financeCycleSequence } from './finance-cycle.js';
export function financeCycleHealth(state,{now=new Date(),internalCycleId=''}={}) {
  if(!validFinanceCycle(state))return {ok:false,status:'BLOCKED',reason:'finance-cycle-unverified'};
  const reference=state.finishedAt||state.updatedAt||state.startedAt;
  const age=new Date(now).getTime()-Date.parse(reference);
  const verified=state.completed.some(s=>s.stage==='reportVerification'&&s.ok&&/^[a-f0-9]{64}$/.test(s.fingerprint||''));
  const internal=internalCycleId===state.id && ['dataHealth','decisions'].includes(financeCycleSequence(state.mode)[state.cursor]);
  const ok=verified && age>=0 && age<=26*3600000 && ((state.status==='COMPLETE'&&!state.pendingFull)||internal);
  const updating=state.waitingForSource===true && ['PENDING','RUNNING'].includes(state.status);
  return {ok,status:ok?'OK':'BLOCKED',reason:ok?'':updating?'finance-cycle-updating':`finance-cycle-${state.status.toLowerCase()}`,
    ...(updating?{updating:true,message:'Поступили новые данные. Идёт обновление отчёта.',resumeAfter:state.resumeAfter}:{}),
    stage:financeCycleSequence(state.mode)[state.cursor]||null,lastCompletedAt:state.finishedAt||state.lastCompletedAt||null};
}

export async function verifiedFinanceCycleHealth(state,options,verifyReports) {
  const cycle=financeCycleHealth(state,options);
  if(!cycle.ok)return cycle;
  const fingerprint=state.completed.find(s=>s.stage==='reportVerification').fingerprint;
  const verification=await verifyReports(fingerprint);
  return verification?.ok===true?cycle:{...cycle,ok:false,status:'BLOCKED',reason:verification?.errorClass==='REPORT_STALE'?'finance-report-stale':'finance-report-unavailable'};
}
