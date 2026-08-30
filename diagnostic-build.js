import { google } from 'googleapis';
const BASE='https://app.dscontrol.ru',SID='1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
function pk(){return String(process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n')}
function arr(j){return Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[])}
function dp(v){const m=String(v??'').match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:null}
function aug(d){return !!d&&d>='2026-08-01'&&d<='2026-08-29'}
function tokRows(op){return (Array.isArray(op?.Tokens)?op.Tokens:[]).filter(t=>Number(t?.Amount)<0).map(t=>({id:String(t?.TokenId),q:-Number(t.Amount)}))}
const headers={api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
async function ops(owner){const r=await fetch(`${BASE}/api/DriveWalletOperationList?OwnerId=${owner}`,{headers});const j=await r.json();if(!r.ok||j?.success===false)throw new Error(`ASHK ${r.status}`);return arr(j)}
const auth=new google.auth.JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:pk(),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});await auth.authorize();const sheets=google.sheets({version:'v4',auth});
const rr=await sheets.spreadsheets.values.get({spreadsheetId:SID,range:"'АШК_Часы_Август'!A2:A3008"});const owners=[...new Set((rr.data.values||[]).map(r=>String(r?.[0]||'').trim()).filter(Boolean))];
let errors=0,totalOps=0,ownersWithAugNoSession=0,ownersChronAsc=0,ownersChronDesc=0,ownersMixed=0;
let outsideBetweenAug=0,outsideBetweenAugHours=0,knownAugBetweenAug=0,knownAugBetweenAugHours=0;
const byToken={},samples=[];
for(let oi=0;oi<owners.length;oi++){
  const owner=owners[oi];
  try{
    const a=await ops(owner); totalOps+=a.length;
    const rows=a.map((op,index)=>({index,hasSession:!!op?.DriveSessionId,date:dp(op?.StartDate)||dp(op?.FinishDate)||dp(op?.PlanStart),id:Number(op?.Id||0),session:String(op?.DriveSessionId||''),hours:Number(op?.Hours||0),toks:tokRows(op),comment:String(op?.Comment||''),master:String(op?.MasterName||'')}));
    const dated=rows.filter(x=>x.date);
    let asc=0,desc=0;
    for(let i=1;i<dated.length;i++){if(dated[i].date>=dated[i-1].date)asc++;if(dated[i].date<=dated[i-1].date)desc++;}
    if(dated.length>1&&asc===dated.length-1)ownersChronAsc++;else if(dated.length>1&&desc===dated.length-1)ownersChronDesc++;else if(dated.length>1)ownersMixed++;
    const anchors=rows.filter(x=>!x.hasSession&&x.id>0&&x.date);
    if(anchors.some(x=>aug(x.date))) ownersWithAugNoSession++;
    for(const s of rows.filter(x=>x.hasSession&&x.hours>0)){
      let prev=null,next=null;
      for(let j=s.index-1;j>=0;j--){const x=rows[j];if(!x.hasSession&&x.id>0&&x.date){prev=x;break;}}
      for(let j=s.index+1;j<rows.length;j++){const x=rows[j];if(!x.hasSession&&x.id>0&&x.date){next=x;break;}}
      if(!prev||!next||!aug(prev.date)||!aug(next.date))continue;
      if(aug(s.date)){knownAugBetweenAug++;knownAugBetweenAugHours+=s.hours;}
      else{
        outsideBetweenAug++;outsideBetweenAugHours+=s.hours;
        for(const t of s.toks)byToken[t.id]=(byToken[t.id]||0)+t.q;
        if(samples.length<80)samples.push({owner,index:s.index,session:s.session,sessionDate:s.date,hours:s.hours,toks:s.toks,master:s.master,prev:{index:prev.index,id:prev.id,date:prev.date,comment:prev.comment},next:{index:next.index,id:next.id,date:next.date,comment:next.comment}});
      }
    }
  }catch(e){errors++;}
  if((oi+1)%150===0||oi===owners.length-1)console.log('ORDER_PROXY_PROGRESS',JSON.stringify({done:oi+1,total:owners.length,errors,totalOps,outsideBetweenAug,outsideBetweenAugHours}));
  await new Promise(r=>setTimeout(r,90));
}
console.log('ORDER_PROXY_OK',JSON.stringify({owners:owners.length,errors,totalOps,ownersWithAugNoSession,ownersChronAsc,ownersChronDesc,ownersMixed,knownAugBetweenAug,knownAugBetweenAugHours,outsideBetweenAug,outsideBetweenAugHours,byToken,samples}));
