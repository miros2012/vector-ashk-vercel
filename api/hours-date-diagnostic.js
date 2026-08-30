import { google } from 'googleapis';

const ASHK_BASE_URL = 'https://app.dscontrol.ru';
const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const OWNER_SHEET = 'АШК_Часы_Август';

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}
async function sheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}
function asArray(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}
function datePart(v) {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
function isAug(d) { return !!d && d >= '2026-08-01' && d <= '2026-08-29'; }
function tokenAmount(op) {
  const arr = Array.isArray(op?.Tokens) ? op.Tokens : [];
  let s = 0;
  for (const t of arr) {
    const n = Number(t?.Amount ?? t?.WriteOffHours ?? t?.Hours ?? 0);
    if (Number.isFinite(n) && n < 0) s += -n;
    else if (Number.isFinite(n) && Number(t?.WriteOffHours) > 0) s += Number(t.WriteOffHours);
  }
  return s;
}
async function fetchOps(owner) {
  const url = `${ASHK_BASE_URL}/api/DriveWalletOperationList?OwnerId=${encodeURIComponent(owner)}`;
  const r = await fetch(url, { headers: {
    api_key: process.env.ASHK_API_KEY,
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json'
  }});
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,200)}`);
  const json = JSON.parse(text);
  if (json?.success === false) throw new Error(JSON.stringify(json.data || json).slice(0,200));
  return asArray(json);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Use GET' });
  try {
    if (!process.env.ASHK_API_KEY) throw new Error('ASHK_API_KEY missing');
    const sheets = await sheetsClient();
    const rr = await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID, range:`'${OWNER_SHEET}'!A2:A3008`});
    const owners = [...new Set((rr.data.values || []).map(r=>String(r?.[0]??'').trim()).filter(Boolean))];
    const forced = ['3561934','3652747','3817878','3643144','3784958','3825402','3752815'];
    const sampleOwners = [...new Set([...forced, ...owners])].slice(0,80);
    const known = new Set(['DriveSessionId','Comment','MasterName','SessionTypeName','VehicleName','AutodromeName','PlanStart','PlanEnd','PlanHours','StartDate','FinishDate','Hours','AutomaticWriteoff','Rate','Feedback','VisitState','Completed','Tokens']);
    const unionKeys = new Set();
    const extraKeys = new Set();
    const extraDateKeys = new Set();
    let errors=0, opsSeen=0, sessionRows=0, augSessionHours=0, augSessionTokens=0;
    let hoursPositiveTokensEmpty=0, hoursPositiveTokensEmptyHours=0;
    let outsideSessionButAugExtra=0, outsideSessionButAugExtraHours=0;
    const mismatchSamples=[];
    const extraDateSamples=[];
    for (let i=0;i<sampleOwners.length;i++) {
      const owner=sampleOwners[i];
      try {
        const ops=await fetchOps(owner);
        opsSeen += ops.length;
        for (const op of ops) {
          for (const k of Object.keys(op||{})) {
            unionKeys.add(k);
            if (!known.has(k)) extraKeys.add(k);
            if (!known.has(k) && /(date|time|created|updated|stamp|dt)/i.test(k)) extraDateKeys.add(k);
          }
          if (!op?.DriveSessionId) continue;
          sessionRows++;
          const h=Number(op?.Hours||0);
          const td=tokenAmount(op);
          const sd=datePart(op?.StartDate)||datePart(op?.FinishDate)||datePart(op?.PlanStart);
          if (isAug(sd)) { augSessionHours += h; augSessionTokens += td; }
          const toks=Array.isArray(op?.Tokens)?op.Tokens:[];
          if (h>0 && toks.length===0) {
            hoursPositiveTokensEmpty++; hoursPositiveTokensEmptyHours += h;
            if (mismatchSamples.length<12) mismatchSamples.push({owner,driveSessionId:op.DriveSessionId,hours:h,planStart:op.PlanStart,startDate:op.StartDate,finishDate:op.FinishDate,completed:op.Completed,automaticWriteoff:op.AutomaticWriteoff,keys:Object.keys(op)});
          }
          if (!isAug(sd)) {
            const extras={}; let hasAug=false;
            for (const k of Object.keys(op||{})) {
              if (known.has(k)) continue;
              const dp=datePart(op[k]);
              if (dp) { extras[k]=op[k]; if (isAug(dp)) hasAug=true; }
            }
            if (hasAug) {
              outsideSessionButAugExtra++; outsideSessionButAugExtraHours += h;
              if (extraDateSamples.length<12) extraDateSamples.push({owner,driveSessionId:op.DriveSessionId,hours:h,sessionDate:sd,extras});
            }
          }
        }
      } catch(e) { errors++; if(errors<5) console.error('OWNER_ERR',owner,String(e)); }
      await new Promise(r=>setTimeout(r,260));
    }
    const result={sampleOwners:sampleOwners.length,errors,opsSeen,sessionRows,augSessionHours,augSessionTokens,hoursPositiveTokensEmpty,hoursPositiveTokensEmptyHours,outsideSessionButAugExtra,outsideSessionButAugExtraHours,extraKeys:[...extraKeys].sort(),extraDateKeys:[...extraDateKeys].sort(),unionKeys:[...unionKeys].sort(),mismatchSamples,extraDateSamples};
    console.log('HOURS_DATE_DIAG_OK',JSON.stringify(result));
    return res.status(200).json({ok:true,mode:'read_only_diagnostic',...result});
  } catch(e) {
    console.error(e);
    return res.status(500).json({ok:false,error:String(e?.message||e)});
  }
}
