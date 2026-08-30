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
const byToken={},samples={};let errors=0,hours=0,tokenHours=0,sessionOps=0;
for(let i=0;i<owners.length;i++){
 try{for(const op of await ops(owners[i])){const d=dp(op?.StartDate)||dp(op?.FinishDate)||dp(op?.PlanStart);if(!op?.DriveSessionId||!aug(d))continue;sessionOps++;hours+=Number(op?.Hours||0);for(const t of(Array.isArray(op?.Tokens)?op.Tokens:[])){const amount=Number(t?.Amount||0);if(!Number.isFinite(amount)||amount>=0)continue;const id=String(t?.TokenId??t?.Id??t?.WalletTokenId??'unknown');const code=String(t?.Code??t?.TokenCode??'');const name=String(t?.Name??t?.TokenName??'');const key=`${id}|${code}|${name}`;byToken[key]=(byToken[key]||0)+(-amount);tokenHours+=-amount;if(!samples[key])samples[key]={owner:owners[i],driveSessionId:op.DriveSessionId,hours:op.Hours,token:t,startDate:op.StartDate,sessionTypeId:op.SessionTypeId,sessionTypeName:op.SessionTypeName};}}
 }catch(e){errors++}
 if((i+1)%100===0||i===owners.length-1)console.log('TOKEN_ID_PROGRESS',JSON.stringify({done:i+1,total:owners.length,errors}));await new Promise(r=>setTimeout(r,120));
}
console.log('TOKEN_ID_AUG_OK',JSON.stringify({owners:owners.length,errors,sessionOps,hours,tokenHours,byToken,samples}));
