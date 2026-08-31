import { google } from 'googleapis';
const BASE='https://app.dscontrol.ru',SID='1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
function pk(){return String(process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n')}
function arr(j){return Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[])}
function dp(v){const s=String(v??'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;m=s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:null}
function toks(op){return (Array.isArray(op?.Tokens)?op.Tokens:[]).filter(t=>Number(t?.Amount)<0).map(t=>({id:String(t?.TokenId),q:-Number(t.Amount)}))}
const headers={api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
async function get(path){const r=await fetch(`${BASE}${path}`,{headers});const j=await r.json();if(!r.ok||j?.success===false)throw new Error(`${path} ${r.status} ${JSON.stringify(j).slice(0,160)}`);return arr(j)}
async function ops(owner){return get(`/api/DriveWalletOperationList?OwnerId=${owner}`)}
function add(map,op){for(const t of toks(op))map[t.id]=(map[t.id]||0)+t.q}
function pick(map){const ids=['2447','3131','4446','4447','4604','5506','5690','5691'];return Object.fromEntries(ids.map(id=>[id,map[id]||0]))}
async function batched(items,size,fn,onProgress){let done=0;for(let i=0;i<items.length;i+=size){await Promise.all(items.slice(i,i+size).map(fn));done=Math.min(i+size,items.length);if(onProgress)onProgress(done);await new Promise(r=>setTimeout(r,1100));}}
const auth=new google.auth.JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:pk(),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});await auth.authorize();const sheets=google.sheets({version:'v4',auth});
const rr=await sheets.spreadsheets.values.get({spreadsheetId:SID,range:"'АШК_Часы_Август'!A2:A3008"});const oldOwners=new Set((rr.data.values||[]).map(r=>String(r?.[0]||'').trim()).filter(Boolean));
const groups=await get('/api/StudyGroupList?ShowArchived=true');
const contracts=new Map();let groupErrors=0;
await batched(groups,4,async g=>{try{const ss=await get(`/api/StudentExternalList?StudyGroupId=${g.Id}`);for(const s of ss)if(s?.Id)contracts.set(String(s.Id),s)}catch(e){groupErrors++;}},done=>{if(done%80<4||done===groups.length)console.log('ALL_CONTRACT_GROUP_PROGRESS',JSON.stringify({done,total:groups.length,contracts:contracts.size,groupErrors}))});
const allOwners=[...contracts.keys()];const excluded=allOwners.filter(id=>!oldOwners.has(id));
console.log('ALL_CONTRACT_UNIVERSE',JSON.stringify({groups:groups.length,contracts:allOwners.length,oldOwners:oldOwners.size,excludedOwners:excluded.length,groupErrors}));
let errors=0,sessionOps=0,augOps=0,augHours=0,preOps=0,preHours=0,jjOps=0,jjHours=0;const augTok={},preTok={},jjTok={};const oldOwnerAugTok={},excludedAugOwners=[];
await batched(excluded,4,async owner=>{try{const a=await ops(owner);let ownerAug=0;for(const op of a){if(!op?.DriveSessionId)continue;sessionOps++;const d=dp(op?.StartDate)||dp(op?.FinishDate)||dp(op?.PlanStart)||dp(op?.PlanEnd);if(!d)continue;const h=Number(op?.Hours||0);if(d>='2026-08-01'&&d<'2026-08-30'){augOps++;augHours+=h;add(augTok,op);ownerAug+=h;}else if(d<'2026-08-01'){preOps++;preHours+=h;add(preTok,op);if(d>='2026-06-01'){jjOps++;jjHours+=h;add(jjTok,op);}}}if(ownerAug>0)excludedAugOwners.push({owner,hours:ownerAug});}catch(e){errors++;}},done=>{if(done%250<4||done===excluded.length)console.log('EXCLUDED_WALLET_PROGRESS',JSON.stringify({done,total:excluded.length,errors,sessionOps,augHours,preHours}))});
console.log('EXCLUDED_AUG',JSON.stringify({ownersWithAug:excludedAugOwners.length,augOps,augHours,byToken:pick(augTok),sample:excludedAugOwners.slice(0,20)}));
console.log('EXCLUDED_PREAUG_ALL',JSON.stringify({preOps,preHours,byToken:pick(preTok)}));
console.log('EXCLUDED_PREAUG_JUNJUL',JSON.stringify({jjOps,jjHours,byToken:pick(jjTok)}));
console.log('LATE_WRITEOFF_CAPACITY',JSON.stringify({needed:{Osn:471,DOP:528,VnG:100,Tsl:57,Dop:4},capacityAll:{Osn:(preTok['4446']||0)+(preTok['5691']||0),DOP:preTok['4447']||0,VnG:preTok['3131']||0,Tsl:(preTok['4604']||0)+(preTok['5690']||0)+(preTok['5506']||0),Dop:preTok['2447']||0},capacityJunJul:{Osn:(jjTok['4446']||0)+(jjTok['5691']||0),DOP:jjTok['4447']||0,VnG:jjTok['3131']||0,Tsl:(jjTok['4604']||0)+(jjTok['5690']||0)+(jjTok['5506']||0),Dop:jjTok['2447']||0},errors}));
