const BASE='https://app.dscontrol.ru';
const OWNERS=['3380781','3433610','3643144'];
const headers={api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
function arr(j){return Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[])}
function dp(v){const s=String(v??'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;m=s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:null}
async function get(owner){const r=await fetch(`${BASE}/api/DriveWalletOperationList?OwnerId=${owner}`,{headers});const text=await r.text();let j;try{j=JSON.parse(text)}catch{throw new Error(`nonjson ${r.status}`)}if(!r.ok||j?.success===false)throw new Error(`${r.status} ${JSON.stringify(j).slice(0,180)}`);return arr(j)}
for(const owner of OWNERS){
  const ops=await get(owner);
  const sessions=ops.filter(o=>o?.DriveSessionId);
  console.log('TX_OWNER',JSON.stringify({owner,ops:ops.length,sessions:sessions.length}));
  for(const o of sessions){
    const d=dp(o?.StartDate)||dp(o?.FinishDate)||dp(o?.PlanStart)||dp(o?.PlanEnd);
    const tx=o?.Transactions;
    const txArr=Array.isArray(tx)?tx:(tx&&typeof tx==='object'?[tx]:[]);
    const txKeys=[...new Set(txArr.flatMap(t=>Object.keys(t||{})))].sort();
    const txDateFields=[];
    for(const t of txArr){for(const [k,v] of Object.entries(t||{})){if(/date|time|created|updated|dt/i.test(k))txDateFields.push([k,v]);}}
    console.log('TX_SESSION',JSON.stringify({owner,DriveSessionId:o?.DriveSessionId,sessionDate:d,Hours:o?.Hours,Tokens:o?.Tokens,Comment:o?.Comment,AutomaticWriteoff:o?.AutomaticWriteoff,Completed:o?.Completed,Id:o?.Id,txType:Array.isArray(tx)?'array':typeof tx,txCount:txArr.length,txKeys,txDateFields,Transactions:tx}));
  }
  await new Promise(r=>setTimeout(r,1200));
}
console.log('TX_PROBE_OK');
