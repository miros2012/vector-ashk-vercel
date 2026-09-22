import { createGoogleSheetsFinanceRunStore } from './google-sheets-finance-run-store.js';
export const FINANCE_CYCLE_KEY='finance_cycle_v1';
export function cycleFromControlRows(rows) {
  const matches=rows.filter(r=>r[0]===FINANCE_CYCLE_KEY);
  if(matches.length>1)throw Error('Duplicate cycle checkpoint');
  if(!matches.length)return null;
  const state=JSON.parse(matches[0][1]);
  if(!state || typeof state!=='object' || Array.isArray(state))throw Error('Malformed cycle checkpoint');
  return state;
}
export function createFinanceCycleStore({sheets,spreadsheetId,lease=createGoogleSheetsFinanceRunStore({sheets,spreadsheetId})}) {
  const api=sheets.spreadsheets.values;
  const readRows=async()=> (await api.get({spreadsheetId,range:"'__vercel_control'!A1:B1009",valueRenderOption:'UNFORMATTED_VALUE'})).data.values||[];
  return {
    async acquire(owner){if(!(await lease.ensureSchema())?.ok)return {ok:false};return lease.acquireLease({runId:owner,leaseMs:360000});},
    release:owner=>lease.releaseLease({runId:owner}),
    read:async()=>cycleFromControlRows(await readRows()),
    async write(state){
      const rows=await readRows();cycleFromControlRows(rows);
      const index=rows.findIndex(r=>r[0]===FINANCE_CYCLE_KEY);const encoded=JSON.stringify(state);
      try {
        if(index<0)await api.append({spreadsheetId,range:"'__vercel_control'!A:B",valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',requestBody:{values:[[FINANCE_CYCLE_KEY,encoded]]}});
        else await api.update({spreadsheetId,range:`'__vercel_control'!B${index+1}`,valueInputOption:'RAW',requestBody:{values:[[encoded]]}});
      } catch { /* Ambiguous transport outcome: verify, never blindly append again. */ }
      const actual=cycleFromControlRows(await readRows());
      if(JSON.stringify(actual)!==encoded)throw Error('Cycle checkpoint readback mismatch');
    }
  };
}
