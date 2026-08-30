import { google } from 'googleapis';
const ASHK_BASE_URL='https://app.dscontrol.ru';
const SPREADSHEET_ID='1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const OWNER_SHEET='АШК_Часы_Август';
function privateKey(){return String(process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n');}
async function sheetsClient(){const auth=new google.auth.JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:privateKey(),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});await auth.authorize();return google.sheets({version:'v4',auth});}
function asArray(j){if(Array.isArray(j))return j;if(Array.isArray(j?.data))return j.data;return[];}
function dp(v){const m=String(v??'').trim().match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:null;}
function aug(d){return!!d&&d>='2026-08-01'&&d<='2026-08-29';}
function tok(op){let s=0;for(const t of(Array.isArray(op?.Tokens)?op.Tokens:[])){const n=Number(t?.Amount??0);if(Number.isFinite(n)&&n<0)s+=-n;}return s;}
async function fetchOps(owner){const r=await fetch(`${ASHK_BASE_URL}/api/DriveWalletOperationList?OwnerId=${encodeURIComponent(owner)}`,{headers:{api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'}});const text=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}`);const j=JSON.parse(text);if(j?.success===false)throw new Error('ASHK fail');return asArray(j);}
export default async function handler(req,res){try{
 const sheets=await sheetsClient();
 const rr=await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:`'${OWNER_SHEET}'!A2:A3008`});
 const owners=[...new Set((rr.data.values||[]).map(r=>String(r?.[0]??'').trim()).filter(Boolean))];
 const forced=['3561934','3652747','3817878','3643144','3784958','3825402','3752815'];
 const offset=Math.max(0,Number(req.query?.offset||0)||0),count=Math.min(120,Math.max(1,Number(req.query?.count||120)||120));
 const pool=[...new Set([...forced,...owners])];
 const sample=pool.slice(offset,offset+count);
 let errors=0,allOps=0,sessionOps=0,augSessionOps=0,sessionHours=0,sessionTokens=0,emptyTokenHours=0,mismatchHours=0,outsideSessionHours=0;
 const opKeys=new Set(),opDateKeys=new Set(),tokenKeys=new Set(),sessionTypeCounts={},forcedStats={},augTopDateOutside=[];
 for(const owner of sample){let fs={ops:0,sessionOps:0,augHours:0,augTokens:0,allSessionHours:0};try{const ops=await fetchOps(owner);fs.ops=ops.length;allOps+=ops.length;for(const op of ops){for(const k of Object.keys(op||{})){opKeys.add(k);if(/(date|time|created|updated|stamp|dt)/i.test(k))opDateKeys.add(k);}for(const t of(Array.isArray(op?.Tokens)?op.Tokens:[]))for(const k of Object.keys(t||{}))tokenKeys.add(k);
 const h=Number(op?.Hours||0),sd=dp(op?.StartDate)||dp(op?.FinishDate)||dp(op?.PlanStart),td=tok(op),hasSession=!!op?.DriveSessionId;
 if(hasSession){sessionOps++;fs.sessionOps++;fs.allSessionHours+=h;if(!aug(sd))outsideSessionHours+=h;const st=String(op?.SessionTypeId??op?.DriveSessionTypeId??'');if(st)sessionTypeCounts[st]=(sessionTypeCounts[st]||0)+1;
  if(aug(sd)){augSessionOps++;fs.augHours+=h;fs.augTokens+=td;sessionHours+=h;sessionTokens+=td;if(h>0&&(!Array.isArray(op?.Tokens)||op.Tokens.length===0))emptyTokenHours+=h;if(Math.abs(h-td)>1e-9)mismatchHours+=Math.abs(h-td);}
  else if(h>0){const dateHits={};for(const k of opDateKeys){const d=dp(op?.[k]);if(aug(d))dateHits[k]=op[k];}if(Object.keys(dateHits).length&&augTopDateOutside.length<50)augTopDateOutside.push({owner,driveSessionId:op.DriveSessionId,hours:h,sessionDate:sd,dateHits,startDate:op?.StartDate,finishDate:op?.FinishDate,planStart:op?.PlanStart,comment:op?.Comment,automaticWriteoff:op?.AutomaticWriteoff,completed:op?.Completed});}
 }
 } }catch(e){errors++;}if(forced.includes(owner))forcedStats[owner]=fs;await new Promise(r=>setTimeout(r,120));}
 const result={offset,countRequested:count,sampleOwners:sample.length,totalPool:pool.length,errors,allOps,sessionOps,augSessionOps,sessionHours,sessionTokens,emptyTokenHours,mismatchHours,outsideSessionHours,opKeys:[...opKeys].sort(),opDateKeys:[...opDateKeys].sort(),tokenKeys:[...tokenKeys].sort(),sessionTypeCounts,forcedStats,augTopDateOutside};
 console.log('HOURS_DATE_CHUNK_OK',JSON.stringify({...result,opKeys:result.opKeys,opDateKeys:result.opDateKeys,tokenKeys:result.tokenKeys,augTopDateOutside:augTopDateOutside.slice(0,10)}));return res.status(200).json({ok:true,mode:'read_only_hours_date_chunk',...result});
 }catch(e){return res.status(500).json({ok:false,error:String(e?.message||e)});}}
