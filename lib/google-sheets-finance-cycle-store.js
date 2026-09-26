import { createGoogleSheetsFinanceRunStore } from './google-sheets-finance-run-store.js';
import { boundedGoogleSheetsRequest } from './google-sheets-lease.js';
export const FINANCE_CYCLE_KEY='finance_cycle_v1';
export function cycleFromControlRows(rows) {
  const matches=rows.filter(r=>r[0]===FINANCE_CYCLE_KEY);
  if(matches.length>1)throw Error('Duplicate cycle checkpoint');
  if(!matches.length)return null;
  const state=JSON.parse(matches[0][1]);
  if(!state || typeof state!=='object' || Array.isArray(state))throw Error('Malformed cycle checkpoint');
  return state;
}
export function createFinanceCycleStore({sheets,spreadsheetId,requestTimeoutMs,lease=createGoogleSheetsFinanceRunStore({sheets,spreadsheetId,requestTimeoutMs}),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  const api=sheets.spreadsheets.values;
  const readRows=async()=> {
    for(let attempt=0;attempt<3;attempt++) {
      try { return (await boundedGoogleSheetsRequest(options=>api.get({spreadsheetId,range:"'__vercel_control'!A1:B1009",valueRenderOption:'UNFORMATTED_VALUE'},options),requestTimeoutMs,'cycle-read')).data.values||[]; }
      catch(error) {
        const code=error?.response?.status ?? error?.code;
        const transient=[429,500,502,503,504].includes(Number(code)) || ['ETIMEDOUT','ECONNRESET','EAI_AGAIN'].includes(code)
          || error?.message==='Google Sheets request timed out';
        if(!transient || attempt===2)throw error;
        await sleep(500*(attempt+1));
      }
    }
  };
  return {
    async acquire(owner){if(!(await lease.ensureSchema())?.ok)return {ok:false};return lease.acquireLease({runId:owner,leaseMs:360000});},
    release:owner=>lease.releaseLease({runId:owner}),
    read:async()=>cycleFromControlRows(await readRows()),
    async write(state){
      const rows=await readRows();cycleFromControlRows(rows);
      const index=rows.findIndex(r=>r[0]===FINANCE_CYCLE_KEY);const encoded=JSON.stringify(state);
      try {
        if(index<0)await boundedGoogleSheetsRequest(options=>api.append({spreadsheetId,range:"'__vercel_control'!A:B",valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',requestBody:{values:[[FINANCE_CYCLE_KEY,encoded]]}},options),requestTimeoutMs,'cycle-append');
        else await boundedGoogleSheetsRequest(options=>api.update({spreadsheetId,range:`'__vercel_control'!B${index+1}`,valueInputOption:'RAW',requestBody:{values:[[encoded]]}},options),requestTimeoutMs,'cycle-update');
      } catch { /* Ambiguous transport outcome: verify, never blindly append again. */ }
      const actual=cycleFromControlRows(await readRows());
      if(JSON.stringify(actual)!==encoded)throw Error('Cycle checkpoint readback mismatch');
    }
  };
}
