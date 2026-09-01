import { createHash } from 'node:crypto';

function clean(v){ return String(v ?? '').trim(); }
function finiteOrNull(v){ if(v===''||v===null||v===undefined) return null; const n=Number(v); return Number.isFinite(n)?n:null; }

function actionCommand(control){
  const action=clean(control.requestedAction);
  const common={ruleId:clean(control.ruleId),actor:'Собственник',expectedExecutionStatus:clean(control.expectedExecutionStatus)};
  if(!common.ruleId) throw new Error('ruleId is required');
  if(action==='В работу') return {...common,action:'start'};
  if(action==='Готово') return {...common,action:'complete',result:clean(control.result),evidence:clean(control.evidence)};
  if(action==='Подтвердить эффект'){
    const actualEffect=finiteOrNull(control.actualEffect);
    if(actualEffect===null) throw new Error('actualEffect is required when verificationStatus is Подтверждено');
    return {...common,action:'verify',verificationStatus:'Подтверждено',actualEffect,evidence:clean(control.evidence)};
  }
  if(action==='Нет эффекта') return {...common,action:'verify',verificationStatus:'Нет эффекта',evidence:clean(control.evidence)};
  if(action==='Не применимо') return {...common,action:'verify',verificationStatus:'Не применимо',evidence:clean(control.evidence)};
  throw new Error(`unsupported requested action: ${action}`);
}

export function normalizeOwnerActionRequest(control={}){
  const command=actionCommand(control);
  const fingerprint=[command.ruleId,command.expectedExecutionStatus,clean(control.requestedAction),clean(control.result),clean(control.evidence),String(control.actualEffect ?? '')].join('|');
  const requestId=`sheet-${createHash('sha256').update(fingerprint).digest('hex').slice(0,24)}`;
  return {requestId,command:{...command,requestId}};
}

export async function processOwnerActionRequest({readControl,claimRequest,executeCommand,markSuccess,markError,now=()=>new Date()}){
  const control=await readControl();
  if(!clean(control?.ruleId)||!clean(control?.requestedAction)) return {ok:true,processed:false,reason:'no-request'};
  let normalized;
  try{ normalized=normalizeOwnerActionRequest(control); }
  catch(error){
    const message=String(error?.message||error);
    await markError('',message,now());
    return {ok:false,processed:false,error:message};
  }
  const {requestId,command}=normalized;
  if(clean(control.processedRequestId)===requestId && clean(control.transportStatus)==='SUCCESS') return {ok:true,processed:false,reason:'already-processed',requestId};
  try{
    if(!(clean(control.currentRequest)===requestId && clean(control.transportStatus)==='SENT')) await claimRequest(requestId,now());
    const result=await executeCommand(command);
    await markSuccess(requestId,result,now());
    return {ok:true,processed:true,requestId,result};
  }catch(error){
    const message=String(error?.message||error);
    await markError(requestId,message,now());
    return {ok:false,processed:true,requestId,error:message};
  }
}
