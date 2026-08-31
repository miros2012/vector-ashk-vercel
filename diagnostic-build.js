import { google } from 'googleapis';
const BASE='https://app.dscontrol.ru',SID='1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
function pk(){return String(process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n')}
function arr(j){return Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[])}
function dp(v){const s=String(v??'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;m=s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:null}
function toks(op){return (Array.isArray(op?.Tokens)?op.Tokens:[]).filter(t=>Number(t?.Amount)<0).map(t=>({id:String(t?.TokenId),q:-Number(t.Amount)}))}
const headers={api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
async function ops(owner){const r=await fetch(`${BASE}/api/DriveWalletOperationList?OwnerId=${owner}`,{headers});const j=await r.json();if(!r.ok||j?.success===false)throw new Error(`ASHK ${r.status}`);return arr(j)}
function add(map,key,op){if(!map[key])map[key]={ops:0,hours:0,byToken:{}};const x=map[key];x.ops++;x.hours+=Number(op?.Hours||0);for(const t of toks(op))x.byToken[t.id]=(x.byToken[t.id]||0)+t.q;}
const auth=new google.auth.JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:pk(),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});await auth.authorize();const sheets=google.sheets({version:'v4',auth});
const rr=await sheets.spreadsheets.values.get({spreadsheetId:SID,range:"'АШК_Часы_Август'!A2:A3008"});const owners=[...new Set((rr.data.values||[]).map(r=>String(r?.[0]||'').trim()).filter(Boolean))];
let errors=0,preOps=0,preHours=0;const byStudents={},byVisit={},byVersion={},byOrder={},bySessionType={},recentByToken={};
async function one(owner){const a=await ops(owner);for(const op of a){if(!op?.DriveSessionId)continue;const d=dp(op?.StartDate)||dp(op?.FinishDate)||dp(op?.PlanStart);if(!d||d>='2026-08-01')continue;preOps++;preHours+=Number(op?.Hours||0);add(byStudents,String(op?.ForStudents),op);add(byVisit,String(op?.VisitState),op);add(byVersion,String(op?.Version),op);add(byOrder,String(op?.OrderNum),op);add(bySessionType,String(op?.SessionTypeId),op);if(d>='2026-06-01')for(const t of toks(op))recentByToken[t.id]=(recentByToken[t.id]||0)+t.q;}}
for(let i=0;i<owners.length;i+=3){await Promise.all(owners.slice(i,i+3).map(async o=>{try{await one(o)}catch(e){errors++;}}));if((i+3)%300<3||i+3>=owners.length)console.log('PREAUG_COMPACT_PROGRESS',JSON.stringify({done:Math.min(i+3,owners.length),total:owners.length,errors,preOps,preHours}));await new Promise(r=>setTimeout(r,1000));}
console.log('PREAUG_COMPACT_BASE',JSON.stringify({owners:owners.length,errors,preOps,preHours,recentByToken}));
console.log('PREAUG_BY_STUDENTS',JSON.stringify(byStudents));
console.log('PREAUG_BY_VISIT',JSON.stringify(byVisit));
console.log('PREAUG_BY_VERSION',JSON.stringify(byVersion));
console.log('PREAUG_BY_ORDER',JSON.stringify(byOrder));
console.log('PREAUG_BY_SESSIONTYPE',JSON.stringify(bySessionType));
