import { google } from 'googleapis';
const BASE='https://app.dscontrol.ru',SID='1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const TARGET=['3380781','3433610','3434851','3437856','3442795','3823974','3840311'];
function pk(){return String(process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n')}
function arr(j){return Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[])}
function dp(v){const s=String(v??'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;m=s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:null}
function toks(op){return (Array.isArray(op?.Tokens)?op.Tokens:[]).filter(t=>Number(t?.Amount)<0).map(t=>({id:String(t?.TokenId),q:-Number(t.Amount)}))}
const headers={api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
async function get(path){const r=await fetch(`${BASE}${path}`,{headers});const j=await r.json();if(!r.ok||j?.success===false)throw new Error(`${path} ${r.status} ${JSON.stringify(j).slice(0,160)}`);return arr(j)}
const groups=await get('/api/StudyGroupList?ShowArchived=true');
const found=new Map();let groupErrors=0;
for(let i=0;i<groups.length;i+=4){await Promise.all(groups.slice(i,i+4).map(async g=>{try{const ss=await get(`/api/StudentExternalList?StudyGroupId=${g.Id}`);for(const s of ss){const id=String(s?.Id||'');if(TARGET.includes(id))found.set(id,{student:s,group:g});}}catch(e){groupErrors++;}}));if(found.size===TARGET.length)break;await new Promise(r=>setTimeout(r,1100));}
console.log('TARGET_CONTRACT_META',JSON.stringify({found:found.size,groupErrors,rows:TARGET.map(id=>{const x=found.get(id)||{};const s=x.student||{},g=x.group||{};return {owner:id,student:s,group:g};})}));
let totalHours=0,totalOps=0;const byToken={};
for(const owner of TARGET){const a=await get(`/api/DriveWalletOperationList?OwnerId=${owner}`);const aug=a.filter(op=>op?.DriveSessionId&&(()=>{const d=dp(op?.StartDate)||dp(op?.FinishDate)||dp(op?.PlanStart)||dp(op?.PlanEnd);return d>='2026-08-01'&&d<'2026-08-30'})());for(const op of aug){totalOps++;totalHours+=Number(op?.Hours||0);for(const t of toks(op))byToken[t.id]=(byToken[t.id]||0)+t.q;}console.log('TARGET_AUG_OWNER',JSON.stringify({owner,count:aug.length,hours:aug.reduce((z,o)=>z+Number(o?.Hours||0),0),ops:aug.map(op=>({keys:Object.keys(op).sort(),Id:op?.Id,DriveSessionId:op?.DriveSessionId,StartDate:op?.StartDate,FinishDate:op?.FinishDate,PlanStart:op?.PlanStart,PlanEnd:op?.PlanEnd,Hours:op?.Hours,Tokens:op?.Tokens,Comment:op?.Comment,AutomaticWriteoff:op?.AutomaticWriteoff,Completed:op?.Completed,ForMasterPayment:op?.ForMasterPayment,ForStudents:op?.ForStudents,VisitState:op?.VisitState,SessionTypeId:op?.SessionTypeId}))}));await new Promise(r=>setTimeout(r,350));}
console.log('TARGET_AUG_SUMMARY',JSON.stringify({owners:TARGET.length,totalOps,totalHours,byToken}));
const auth=new google.auth.JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:pk(),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});await auth.authorize();const sheets=google.sheets({version:'v4',auth});
const rr=await sheets.spreadsheets.values.get({spreadsheetId:SID,range:"'АШК_Часы_Август'!A2:A3008"});const old=new Set((rr.data.values||[]).map(r=>String(r?.[0]||'').trim()).filter(Boolean));console.log('TARGET_OLD_UNIVERSE_MEMBERSHIP',JSON.stringify(TARGET.map(owner=>({owner,inOld:old.has(owner)}))));
