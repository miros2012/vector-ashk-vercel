import { google } from 'googleapis';
const BASE='https://app.dscontrol.ru';
const SID='1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
function pk(){return String(process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n')}
function arr(j){return Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[])}
function dp(v){const m=String(v??'').match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:null}
function aug(d){return d>='2026-08-01'&&d<='2026-08-29'}
async function ops(owner){const r=await fetch(`${BASE}/api/DriveWalletOperationList?OwnerId=${owner}`,{headers:{api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'}});const j=await r.json();if(!r.ok||j?.success===false)throw new Error(`ASHK ${r.status}`);return arr(j)}
const auth=new google.auth.JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:pk(),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});await auth.authorize();const sheets=google.sheets({version:'v4',auth});
const rr=await sheets.spreadsheets.values.get({spreadsheetId:SID,range:"'АШК_Часы_Август'!A2:A3008"});const owners=[...new Set((rr.data.values||[]).map(r=>String(r?.[0]||'').trim()).filter(Boolean))];
const candidateIds=new Set();const fieldHits={};let errors=0,sessionOps=0;
for(let i=0;i<owners.length;i++){
 try{for(const op of await ops(owners[i])){const d=dp(op?.StartDate)||dp(op?.FinishDate)||dp(op?.PlanStart);if(!op?.DriveSessionId||!aug(d))continue;sessionOps++;for(const [k,v] of Object.entries(op)){if(!/(instructor|master|teacher|employee|staff|driver|person)/i.test(k))continue;const vals=Array.isArray(v)?v:[v];for(const x of vals){if(x&&typeof x==='object'){for(const [kk,vv] of Object.entries(x)){if(/id$/i.test(kk)&&/^\d+$/.test(String(vv??'')))candidateIds.add(String(vv));}}else if(/id$/i.test(k)&&/^\d+$/.test(String(x??'')))candidateIds.add(String(x));}if(!fieldHits[k])fieldHits[k]=typeof v==='object'?JSON.stringify(v).slice(0,250):String(v).slice(0,250);}}
 }}catch(e){errors++}
 if((i+1)%150===0||i===owners.length-1)console.log('MASTER_ID_DISCOVERY_PROGRESS',JSON.stringify({done:i+1,total:owners.length,errors,candidates:candidateIds.size}));await new Promise(r=>setTimeout(r,90));
}
console.log('MASTER_ID_DISCOVERY',JSON.stringify({owners:owners.length,sessionOps,errors,candidateIds:[...candidateIds].slice(0,500),fieldHits}));
const byToken={},samples={};let masterErrors=0,masterHours=0,masterSessionOps=0;const candidateList=[...candidateIds];
for(let i=0;i<candidateList.length;i++){
 const owner=candidateList[i];try{for(const op of await ops(owner)){const d=dp(op?.StartDate)||dp(op?.FinishDate)||dp(op?.PlanStart);if(!aug(d))continue;const toks=Array.isArray(op?.Tokens)?op.Tokens:[];let any=false;for(const t of toks){const a=Number(t?.Amount||0);if(!Number.isFinite(a)||a>=0)continue;const id=String(t?.TokenId??t?.Id??t?.WalletTokenId??'unknown');byToken[id]=(byToken[id]||0)+(-a);masterHours+=(-a);any=true;if(!samples[id])samples[id]={owner,driveSessionId:op?.DriveSessionId??null,startDate:op?.StartDate??null,hours:op?.Hours??null,token:t,keys:Object.keys(op)};}if(any&&op?.DriveSessionId)masterSessionOps++;}}catch(e){masterErrors++;}
 if((i+1)%50===0||i===candidateList.length-1)console.log('MASTER_WALLET_PROGRESS',JSON.stringify({done:i+1,total:candidateList.length,masterErrors}));await new Promise(r=>setTimeout(r,90));
}
console.log('MASTER_WALLET_AUG_OK',JSON.stringify({candidateOwners:candidateList.length,masterErrors,masterSessionOps,masterHours,byToken,samples}));
