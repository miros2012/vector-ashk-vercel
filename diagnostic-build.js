import { google } from 'googleapis';
const BASE='https://app.dscontrol.ru';
const SID='1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const TARGET='АШК_Движения_балансов__missing_active';
const owners=['3561934','3652747','3817878','3643144','3784958','3825402','3752815'];
function pk(){return String(process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n')}
function arr(j){return Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[])}
function dp(v){const m=String(v??'').match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:null}
function aug(d){return d>='2026-08-01'&&d<='2026-08-29'}
const headers={api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
async function ops(owner){const r=await fetch(`${BASE}/api/DriveWalletOperationList?OwnerId=${owner}`,{headers});const j=await r.json();if(!r.ok||j?.success===false)throw new Error(`ASHK ${r.status}`);return arr(j)}
const auth=new google.auth.JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:pk(),scopes:['https://www.googleapis.com/auth/spreadsheets']});await auth.authorize();const sheets=google.sheets({version:'v4',auth});
const rows=[];const byOwner={};const byToken={};let errors=0,totalHours=0,totalTokenHours=0;
for(const owner of owners){let ownerHours=0,ownerToken=0,sessionOps=0;try{for(const op of await ops(owner)){const d=dp(op?.StartDate)||dp(op?.FinishDate)||dp(op?.PlanStart);if(!op?.DriveSessionId||!aug(d))continue;sessionOps++;const h=Number(op?.Hours||0);if(Number.isFinite(h)){ownerHours+=h;totalHours+=h;}const toks=Array.isArray(op?.Tokens)?op.Tokens:[];for(const t of toks){const a=Number(t?.Amount||0);if(!Number.isFinite(a)||a>=0)continue;const q=-a;ownerToken+=q;totalTokenHours+=q;const tokenId=String(t?.TokenId??t?.Id??t?.WalletTokenId??'');const code=String(t?.Code??t?.TokenCode??t?.ShortName??'');const name=String(t?.Name??t?.TokenName??'');byToken[tokenId]=(byToken[tokenId]||0)+q;rows.push([owner,String(op?.DriveSessionId??''),d,String(op?.StartDate??''),String(op?.FinishDate??''),h,tokenId,code,name,q,String(op?.MasterName??''),String(op?.SessionTypeName??''),String(op?.AutomaticWriteoff??''),String(op?.Completed??''),String(op?.ForMasterPayment??''),String(op?.Comment??'')]);}}}catch(e){errors++;byOwner[owner]={error:String(e).slice(0,200)};continue;}byOwner[owner]={sessionOps,hours:ownerHours,tokenHours:ownerToken};await new Promise(r=>setTimeout(r,120));}
await sheets.spreadsheets.values.clear({spreadsheetId:SID,range:`'${TARGET}'!A:P`});
const values=[['OwnerId','DriveSessionId','Date','StartDate','FinishDate','Hours','TokenId','TokenCode','TokenName','TokenHours','MasterName','SessionTypeName','AutomaticWriteoff','Completed','ForMasterPayment','Comment'],...rows];
await sheets.spreadsheets.values.update({spreadsheetId:SID,range:`'${TARGET}'!A1`,valueInputOption:'RAW',requestBody:{values}});
const vr=await sheets.spreadsheets.values.get({spreadsheetId:SID,range:`'${TARGET}'!A1:P${values.length}`});
console.log('MISSING_ACTIVE_OK',JSON.stringify({owners:owners.length,errors,rows:rows.length,writtenRows:(vr.data.values||[]).length-1,totalHours,totalTokenHours,byOwner,byToken}));
