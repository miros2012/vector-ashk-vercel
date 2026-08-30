const BASE='https://app.dscontrol.ru';
const SAMPLE=['3793158','3834182','3649595','3768765','3784751','3807737','3810403','3719202','3795179','3773425','3779901','3780547'];
function arr(j){return Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[])}
function dp(v){const m=String(v??'').match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:null}
function aug(d){return !!d&&d>='2026-08-01'&&d<='2026-08-29'}
function toks(op){return (Array.isArray(op?.Tokens)?op.Tokens:[]).filter(t=>Number(t?.Amount)<0).map(t=>({id:String(t?.TokenId),q:-Number(t.Amount)}))}
const headers={api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
async function ops(owner){const r=await fetch(`${BASE}/api/DriveWalletOperationList?OwnerId=${owner}`,{headers});const j=await r.json();if(!r.ok||j?.success===false)throw new Error(`ASHK ${r.status}`);return arr(j)}
let errors=0,outsideBetweenAug=0,outsideBetweenAugHours=0;const byToken={},owners=[];
for(const owner of SAMPLE){
  try{
    const raw=await ops(owner);
    const rows=raw.map((op,index)=>({index,hasSession:!!op?.DriveSessionId,id:Number(op?.Id||0),date:dp(op?.StartDate)||dp(op?.FinishDate)||dp(op?.PlanStart),session:String(op?.DriveSessionId||''),hours:Number(op?.Hours||0),toks:toks(op),comment:String(op?.Comment||''),master:String(op?.MasterName||'')}));
    const anchors=rows.filter(x=>!x.hasSession&&x.id>0&&x.date&&aug(x.date));
    const windows=[];
    for(const s of rows.filter(x=>x.hasSession&&x.hours>0&&!aug(x.date))){
      let prev=null,next=null;
      for(let j=s.index-1;j>=0;j--){const x=rows[j];if(!x.hasSession&&x.id>0&&x.date){prev=x;break;}}
      for(let j=s.index+1;j<rows.length;j++){const x=rows[j];if(!x.hasSession&&x.id>0&&x.date){next=x;break;}}
      if(prev&&next&&aug(prev.date)&&aug(next.date)){
        outsideBetweenAug++;outsideBetweenAugHours+=s.hours;for(const t of s.toks)byToken[t.id]=(byToken[t.id]||0)+t.q;
        windows.push({index:s.index,session:s.session,sessionDate:s.date,hours:s.hours,toks:s.toks,prev:{index:prev.index,id:prev.id,date:prev.date,comment:prev.comment},next:{index:next.index,id:next.id,date:next.date,comment:next.comment}});
      }
    }
    const compact=rows.filter(x=>x.hasSession||aug(x.date)).slice(0,80).map(x=>({i:x.index,s:x.hasSession,id:x.id,d:x.date,ds:x.session,h:x.hours,t:x.toks,c:x.comment.slice(0,70)}));
    owners.push({owner,total:rows.length,augAnchors:anchors.map(x=>({i:x.index,id:x.id,d:x.date,c:x.comment.slice(0,90)})),windows,compact});
  }catch(e){errors++;owners.push({owner,error:String(e?.message||e)});}
}
console.log('ORDER_MINI_OK',JSON.stringify({sample:SAMPLE.length,errors,outsideBetweenAug,outsideBetweenAugHours,byToken,owners}));
