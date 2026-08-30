const BASE='https://app.dscontrol.ru';
function arr(j){return Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[])}
function dp(v){const m=String(v??'').match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:null}
function aug(d){return d>='2026-08-01'&&d<='2026-08-29'}
const headers={api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
async function get(path){
  const r=await fetch(`${BASE}${path}`,{headers});
  const j=await r.json();
  if(!r.ok||j?.success===false)throw new Error(`${path} ASHK ${r.status} ${JSON.stringify(j).slice(0,300)}`);
  return arr(j);
}
async function ops(owner){return get(`/api/DriveWalletOperationList?OwnerId=${owner}`)}
const employees=await get('/api/SchoolEmployeeLeads');
const likely=employees.filter(e=>/мастер|инструктор|вожд|преподав/i.test([...(Array.isArray(e?.PositionNames)?e.PositionNames:[]),e?.PersonName||''].join(' ')));
console.log('EMPLOYEE_UNIVERSE',JSON.stringify({employees:employees.length,likely:likely.length,likelyEmployees:likely.map(e=>({id:e.Id,name:e.PersonName,positions:e.PositionNames}))}));
const byToken={},samples={},ownersWithOps=[];
let errors=0,totalOps=0,augOps=0,augHours=0,augTokenHours=0;
for(let i=0;i<likely.length;i++){
  const e=likely[i];
  try{
    const list=await ops(e.Id);
    totalOps+=list.length;
    let ownerAug=0,ownerToken=0,ownerOps=0;
    for(const op of list){
      const d=dp(op?.StartDate)||dp(op?.FinishDate)||dp(op?.PlanStart);
      if(!aug(d))continue;
      ownerOps++;
      const h=Number(op?.Hours||0);
      if(Number.isFinite(h))ownerAug+=h;
      const toks=Array.isArray(op?.Tokens)?op.Tokens:[];
      for(const t of toks){
        const a=Number(t?.Amount||0);
        if(!Number.isFinite(a)||a>=0)continue;
        const q=-a;
        const id=String(t?.TokenId??t?.Id??t?.WalletTokenId??'unknown');
        byToken[id]=(byToken[id]||0)+q;
        ownerToken+=q;
        if(!samples[id])samples[id]={employeeId:e.Id,employee:e.PersonName,positions:e.PositionNames,startDate:op?.StartDate??null,finishDate:op?.FinishDate??null,planStart:op?.PlanStart??null,driveSessionId:op?.DriveSessionId??null,hours:op?.Hours??null,token:t,masterName:op?.MasterName??null,forMasterPayment:op?.ForMasterPayment??null,keys:Object.keys(op)};
      }
    }
    if(ownerOps||ownerAug||ownerToken)ownersWithOps.push({id:e.Id,name:e.PersonName,positions:e.PositionNames,ops:list.length,augOps:ownerOps,augHours:ownerAug,augTokenHours:ownerToken});
    augOps+=ownerOps;augHours+=ownerAug;augTokenHours+=ownerToken;
  }catch(err){errors++;console.log('EMPLOYEE_WALLET_ERROR',JSON.stringify({id:e.Id,name:e.PersonName,error:String(err).slice(0,300)}));}
  console.log('EMPLOYEE_WALLET_PROGRESS',JSON.stringify({done:i+1,total:likely.length,errors,ownersWithOps:ownersWithOps.length,augHours,augTokenHours}));
  await new Promise(r=>setTimeout(r,1050));
}
console.log('EMPLOYEE_WALLET_AUG_OK',JSON.stringify({employees:employees.length,likely:likely.length,errors,totalOps,augOps,augHours,augTokenHours,byToken,ownersWithOps,samples}));
