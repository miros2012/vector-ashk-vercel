import { google } from 'googleapis';
const BASE='https://app.dscontrol.ru';
const SID='1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
function pk(){return String(process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n')}
function arr(j){return Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[])}
function dp(v){const m=String(v??'').match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:null}
function aug(d){return d>='2026-08-01'&&d<='2026-08-29'}
const headers={api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
async function ops(owner){const r=await fetch(`${BASE}/api/DriveWalletOperationList?OwnerId=${owner}`,{headers});const j=await r.json();if(!r.ok||j?.success===false)throw new Error(`ASHK ${r.status}`);return arr(j)}
const auth=new google.auth.JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:pk(),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});await auth.authorize();
const sheets=google.sheets({version:'v4',auth});
const rr=await sheets.spreadsheets.values.get({spreadsheetId:SID,range:"'АШК_Часы_Август'!A2:A3008"});
const owners=[...new Set((rr.data.values||[]).map(r=>String(r?.[0]||'').trim()).filter(Boolean))];
const bucket=(o,k,h)=>{const v=String(k??'∅');o[v]??={ops:0,hours:0,tokens:0};o[v].ops++;o[v].hours+=h.hours;o[v].tokens+=h.tokens};
const byForMasterPayment={},byAutomaticWriteoff={},byCompleted={},byVisitState={},bySessionType={},byTokenRowCount={};
const sessionMap=new Map();const samples=[];let errors=0,opsCount=0,hours=0,tokens=0,multiTokenOps=0,zeroTokenOps=0;
for(let i=0;i<owners.length;i++){
 try{for(const op of await ops(owners[i])){const d=dp(op?.StartDate)||dp(op?.FinishDate)||dp(op?.PlanStart);if(!op?.DriveSessionId||!aug(d))continue;opsCount++;const h=Number(op?.Hours||0);let tSum=0;const toks=Array.isArray(op?.Tokens)?op.Tokens:[];for(const t of toks){const a=Number(t?.Amount||0);if(Number.isFinite(a)&&a<0)tSum+=-a;}hours+=h;tokens+=tSum;if(toks.length>1)multiTokenOps++;if(toks.length===0)zeroTokenOps++;const pair={hours:h,tokens:tSum};bucket(byForMasterPayment,op?.ForMasterPayment,pair);bucket(byAutomaticWriteoff,op?.AutomaticWriteoff,pair);bucket(byCompleted,op?.Completed,pair);bucket(byVisitState,op?.VisitState,pair);bucket(bySessionType,op?.SessionTypeName??op?.SessionTypeId,pair);bucket(byTokenRowCount,toks.length,pair);
 const id=String(op.DriveSessionId);const cur=sessionMap.get(id)||[];cur.push({owner:owners[i],hours:h,tokens:tSum,start:op?.StartDate,finish:op?.FinishDate,plan:op?.PlanStart,master:op?.MasterName,sessionType:op?.SessionTypeName,forMasterPayment:op?.ForMasterPayment,automaticWriteoff:op?.AutomaticWriteoff,completed:op?.Completed,visitState:op?.VisitState,tokenIds:toks.map(x=>x?.TokenId??x?.Id??x?.WalletTokenId),tokenAmounts:toks.map(x=>x?.Amount)});sessionMap.set(id,cur);
 }}catch(e){errors++;}
 if((i+1)%150===0||i===owners.length-1)console.log('SEMANTIC_PROGRESS',JSON.stringify({done:i+1,total:owners.length,errors,opsCount,hours,tokens}));
 await new Promise(r=>setTimeout(r,90));
}
let repeatedSessionIds=0,repeatedRows=0,repeatedHours=0,repeatedTokens=0,differentRepeatedRows=0;
for(const [id,rows] of sessionMap){if(rows.length<2)continue;repeatedSessionIds++;repeatedRows+=rows.length;repeatedHours+=rows.reduce((s,r)=>s+r.hours,0);repeatedTokens+=rows.reduce((s,r)=>s+r.tokens,0);const sig=new Set(rows.map(r=>JSON.stringify([r.owner,r.hours,r.tokens,r.start,r.finish,r.plan,r.sessionType,r.forMasterPayment,r.tokenIds,r.tokenAmounts])));if(sig.size>1)differentRepeatedRows++;if(samples.length<30)samples.push({driveSessionId:id,rowCount:rows.length,different:sig.size>1,rows});}
console.log('SEMANTIC_AUG_OK',JSON.stringify({owners:owners.length,errors,opsCount,hours,tokens,multiTokenOps,zeroTokenOps,uniqueSessionIds:sessionMap.size,repeatedSessionIds,repeatedRows,repeatedHours,repeatedTokens,differentRepeatedRows,byForMasterPayment,byAutomaticWriteoff,byCompleted,byVisitState,bySessionType,byTokenRowCount,samples}));
