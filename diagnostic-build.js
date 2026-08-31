const BASE='https://app.dscontrol.ru';
const OWNERS=['3380781','3433610','3643144'];
const headers={api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
function arr(j){return Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[])}
function dp(v){const s=String(v??'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;m=s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:null}
function sig(ops){const rows=ops.map(o=>[String(o?.DriveSessionId||''),String(o?.Id||''),String(o?.StartDate||''),String(o?.FinishDate||''),String(o?.PlanStart||''),String(o?.Hours||''),JSON.stringify(o?.Tokens||[])].join('|')).sort();let h=2166136261;for(const s of rows){for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}}return (h>>>0).toString(16)}
async function get(owner,qs){const url=`${BASE}/api/DriveWalletOperationList?OwnerId=${owner}${qs?'&'+qs:''}`;const r=await fetch(url,{headers});const text=await r.text();let j;try{j=JSON.parse(text)}catch{throw new Error(`nonjson ${r.status}`)}if(!r.ok||j?.success===false)throw new Error(`${r.status} ${JSON.stringify(j).slice(0,180)}`);return arr(j)}
const variants={
 baseline:'',
 dateFromTo:'DateFrom=2026-08-01&DateTo=2026-08-29',
 startFinish:'StartDate=2026-08-01&FinishDate=2026-08-29',
 fromTo:'From=2026-08-01&To=2026-08-29',
 beginEnd:'BeginDate=2026-08-01&EndDate=2026-08-29',
 includeCompleted:'IncludeCompleted=true&All=true&Extended=true'
};
const out=[];
for(const owner of OWNERS){let base=null;for(const [name,qs] of Object.entries(variants)){try{const ops=await get(owner,qs);const sessions=ops.filter(o=>o?.DriveSessionId);const aug=sessions.filter(o=>{const d=dp(o?.StartDate)||dp(o?.FinishDate)||dp(o?.PlanStart)||dp(o?.PlanEnd);return d>='2026-08-01'&&d<='2026-08-29'});const old=sessions.filter(o=>{const d=dp(o?.StartDate)||dp(o?.FinishDate)||dp(o?.PlanStart)||dp(o?.PlanEnd);return d&&d<'2026-08-01'});const rec={owner,name,totalOps:ops.length,sessionOps:sessions.length,augOps:aug.length,augHours:aug.reduce((s,o)=>s+Number(o?.Hours||0),0),oldOps:old.length,oldHours:old.reduce((s,o)=>s+Number(o?.Hours||0),0),keys:[...new Set(ops.flatMap(o=>Object.keys(o||{})))].sort(),signature:sig(ops)};if(name==='baseline')base=rec;rec.sameAsBaseline=base?rec.signature===base.signature:null;out.push(rec);console.log('DWO_PARAM_VARIANT',JSON.stringify(rec));}catch(e){out.push({owner,name,error:String(e?.message||e)});console.log('DWO_PARAM_ERROR',JSON.stringify({owner,name,error:String(e?.message||e)}));}await new Promise(r=>setTimeout(r,1100));}}
console.log('DWO_PARAM_PROBE_OK',JSON.stringify(out));
