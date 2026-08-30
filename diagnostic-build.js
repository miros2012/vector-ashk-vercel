import { google } from 'googleapis';
const BASE='https://app.dscontrol.ru',SID='1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
function pk(){return String(process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n')}
function arr(j){return Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[])}
function dp(v){const s=String(v??'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;m=s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:null}
function aug(d){return !!d&&d>='2026-08-01'&&d<='2026-08-29'}
function th(op){return (Array.isArray(op?.Tokens)?op.Tokens:[]).filter(t=>Number(t?.Amount)<0).reduce((s,t)=>s-Number(t.Amount),0)}
function toks(op){return (Array.isArray(op?.Tokens)?op.Tokens:[]).filter(t=>Number(t?.Amount)<0).map(t=>({id:String(t?.TokenId),q:-Number(t.Amount)}))}
const headers={api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
async function ops(owner){const r=await fetch(`${BASE}/api/DriveWalletOperationList?OwnerId=${owner}`,{headers});const j=await r.json();if(!r.ok||j?.success===false)throw new Error(`ASHK ${r.status}`);return arr(j)}
const auth=new google.auth.JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:pk(),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});await auth.authorize();const sheets=google.sheets({version:'v4',auth});
const rr=await sheets.spreadsheets.values.get({spreadsheetId:SID,range:"'АШК_Часы_Август'!A2:A3008"});const owners=[...new Set((rr.data.values||[]).map(r=>String(r?.[0]||'').trim()).filter(Boolean))];
const fields=['StartDate','FinishDate','PlanStart','PlanEnd'];const stats={};for(const f of fields)stats[f]={ops:0,hours:0,tokens:0,byToken:{}};
const patterns={};let errors=0,sessionOps=0;const samples=[];
for(let oi=0;oi<owners.length;oi++){
 try{for(const op of await ops(owners[oi])){if(!op?.DriveSessionId)continue;sessionOps++;const d={};for(const f of fields)d[f]=dp(op?.[f]);const key=fields.map(f=>aug(d[f])?'1':'0').join('');const h=Number(op?.Hours||0),tv=th(op);if(!patterns[key])patterns[key]={ops:0,hours:0,tokens:0,byToken:{}};patterns[key].ops++;patterns[key].hours+=h;patterns[key].tokens+=tv;for(const t of toks(op))patterns[key].byToken[t.id]=(patterns[key].byToken[t.id]||0)+t.q;
   for(const f of fields)if(aug(d[f])){stats[f].ops++;stats[f].hours+=h;stats[f].tokens+=tv;for(const t of toks(op))stats[f].byToken[t.id]=(stats[f].byToken[t.id]||0)+t.q;}
   if(key!=='0000'&&key!=='1111'&&samples.length<150)samples.push({owner:owners[oi],session:String(op.DriveSessionId),dates:d,key,hours:h,toks:toks(op),master:op?.MasterName,sessionTypeId:op?.SessionTypeId,planHours:op?.PlanHours});
 }}catch(e){errors++;}
 if((oi+1)%150===0||oi===owners.length-1)console.log('DATE_CROSS_PROGRESS',JSON.stringify({done:oi+1,total:owners.length,errors,sessionOps}));await new Promise(r=>setTimeout(r,90));
}
console.log('DATE_CROSS_OK',JSON.stringify({owners:owners.length,errors,sessionOps,fields,stats,patterns,samples}));
