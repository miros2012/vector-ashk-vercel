import { google } from 'googleapis';

const ASHK_BASE_URL = 'https://app.dscontrol.ru';
const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const OWNER_SHEET = 'АШК_Часы_Август';

function privateKey() { return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'); }
async function sheetsClient() {
  const auth = new google.auth.JWT({ email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key:privateKey(), scopes:['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await auth.authorize();
  return google.sheets({version:'v4',auth});
}
function asArray(json) { if(Array.isArray(json)) return json; if(Array.isArray(json?.data)) return json.data; return []; }
function datePart(v) { const s=String(v??'').trim(); const m=s.match(/^(\d{4}-\d{2}-\d{2})/); return m?m[1]:null; }
function isAug(d) { return !!d && d>='2026-08-01' && d<='2026-08-29'; }
function tokenAmount(op) {
  let s=0; for(const t of (Array.isArray(op?.Tokens)?op.Tokens:[])) { const n=Number(t?.Amount ?? t?.WriteOffHours ?? t?.Hours ?? 0); if(Number.isFinite(n)&&n<0)s+=-n; else if(Number.isFinite(n)&&Number(t?.WriteOffHours)>0)s+=Number(t.WriteOffHours); } return s;
}
async function fetchOps(owner) {
  const r=await fetch(`${ASHK_BASE_URL}/api/DriveWalletOperationList?OwnerId=${encodeURIComponent(owner)}`,{headers:{api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'}});
  const text=await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,200)}`); const json=JSON.parse(text); if(json?.success===false) throw new Error(JSON.stringify(json.data||json).slice(0,200)); return asArray(json);
}
function nestedDateFields(obj){ const out={}; for(const [k,v] of Object.entries(obj||{})){ if(/(date|time|created|updated|stamp|dt)/i.test(k)){ const d=datePart(v); if(d) out[k]=v; } } return out; }

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Use GET'});
  try{
    if(!process.env.ASHK_API_KEY) throw new Error('ASHK_API_KEY missing');
    const sheets=await sheetsClient();
    const rr=await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:`'${OWNER_SHEET}'!A2:A3008`});
    const owners=[...new Set((rr.data.values||[]).map(r=>String(r?.[0]??'').trim()).filter(Boolean))];
    const forced=['3561934','3652747','3817878','3643144','3784958','3825402','3752815'];
    const sampleOwners=[...new Set([...forced,...owners])].slice(0,120);
    let errors=0,opsSeen=0,sessionRows=0,augSessionHours=0,augSessionTokens=0,hoursPositiveTokensEmpty=0;
    let transactionRows=0, sessionsWithTransactions=0, outsideSessionButAugTxDate=0, outsideSessionButAugTxHours=0;
    const txKeys=new Set(),tokenKeys=new Set(),txDateKeys=new Set(),txSamples=[],outsideSamples=[],opSamples=[];
    for(const owner of sampleOwners){
      try{
        const ops=await fetchOps(owner); opsSeen+=ops.length;
        for(const op of ops){
          if(!op?.DriveSessionId) continue; sessionRows++;
          const h=Number(op?.Hours||0), td=tokenAmount(op), sd=datePart(op?.StartDate)||datePart(op?.FinishDate)||datePart(op?.PlanStart);
          if(isAug(sd)){augSessionHours+=h;augSessionTokens+=td;}
          const toks=Array.isArray(op?.Tokens)?op.Tokens:[]; if(h>0&&toks.length===0) hoursPositiveTokensEmpty++;
          for(const t of toks) for(const k of Object.keys(t||{})) tokenKeys.add(k);
          const txs=Array.isArray(op?.Transactions)?op.Transactions:[];
          if(txs.length){ sessionsWithTransactions++; transactionRows+=txs.length; }
          let hasAugTx=false; const txDates=[];
          for(const tx of txs){
            for(const k of Object.keys(tx||{})){ txKeys.add(k); if(/(date|time|created|updated|stamp|dt)/i.test(k)) txDateKeys.add(k); }
            const dfs=nestedDateFields(tx); for(const [k,v] of Object.entries(dfs)){ txDates.push({k,v}); if(isAug(datePart(v))) hasAugTx=true; }
            if(txSamples.length<20) txSamples.push({owner,driveSessionId:op.DriveSessionId,sessionDate:sd,hours:h,sessionTypeId:op.SessionTypeId,sessionTypeName:op.SessionTypeName,tx});
          }
          if(!isAug(sd)&&hasAugTx){ outsideSessionButAugTxDate++; outsideSessionButAugTxHours+=h; if(outsideSamples.length<20) outsideSamples.push({owner,driveSessionId:op.DriveSessionId,sessionDate:sd,hours:h,sessionTypeId:op.SessionTypeId,sessionTypeName:op.SessionTypeName,txDates,transactions:txs}); }
          if(opSamples.length<8&&txs.length) opSamples.push({owner,driveSessionId:op.DriveSessionId,hours:h,startDate:op.StartDate,finishDate:op.FinishDate,planStart:op.PlanStart,completed:op.Completed,automaticWriteoff:op.AutomaticWriteoff,forMasterPayment:op.ForMasterPayment,transactions:txs,tokens:toks});
        }
      }catch(e){errors++;if(errors<5)console.error('OWNER_ERR',owner,String(e));}
      await new Promise(r=>setTimeout(r,220));
    }
    const result={sampleOwners:sampleOwners.length,errors,opsSeen,sessionRows,augSessionHours,augSessionTokens,hoursPositiveTokensEmpty,sessionsWithTransactions,transactionRows,outsideSessionButAugTxDate,outsideSessionButAugTxHours,txKeys:[...txKeys].sort(),txDateKeys:[...txDateKeys].sort(),tokenKeys:[...tokenKeys].sort(),txSamples,outsideSamples,opSamples};
    console.log('HOURS_TX_DIAG_OK',JSON.stringify({...result,txSamples:txSamples.slice(0,3),outsideSamples:outsideSamples.slice(0,3),opSamples:opSamples.slice(0,2)}));
    return res.status(200).json({ok:true,mode:'read_only_transactions_diagnostic',...result});
  }catch(e){console.error(e);return res.status(500).json({ok:false,error:String(e?.message||e)});}
}
