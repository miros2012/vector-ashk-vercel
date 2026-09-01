import { calculateDecisionEffectiveness } from './decision-effectiveness.js';

function num(value){ if(value===''||value===null||value===undefined) return null; const n=Number(value); return Number.isFinite(n)?n:null; }

function decision(row=[]){
  return {
    ruleId:String(row[0]||'').trim(),
    executionStatus:String(row[10]||'Не начато').trim(),
    plannedEffect:num(row[12])??0,
    actualEffect:num(row[13]),
    verificationStatus:String(row[20]||'Не проверено').trim()
  };
}
function event(row=[]){
  return {
    eventId:String(row[0]||'').trim(), ruleId:String(row[1]||'').trim(), type:String(row[2]||'').trim(), at:String(row[3]||'').trim(),
    before:String(row[4]||'').trim(), after:String(row[5]||'').trim(), actor:String(row[6]||'').trim(), plannedEffect:num(row[7])??0,
    actualEffect:num(row[8]), evidence:String(row[9]||'').trim(), comment:String(row[10]||'').trim()
  };
}

export function createDecisionEffectivenessSheetAdapter({sheets,spreadsheetId,decisionsSheet='Решения',historySheet='История решений'}){
  return {
    async readEffectiveness(){
      const response=await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges:[`'${decisionsSheet}'!A2:V200`,`'${historySheet}'!A2:K1000`],
        valueRenderOption:'UNFORMATTED_VALUE'
      });
      const ranges=response.data.valueRanges||[];
      const decisions=(ranges[0]?.values||[]).map(decision).filter((d)=>d.ruleId);
      const history=(ranges[1]?.values||[]).map(event).filter((e)=>e.ruleId);
      return calculateDecisionEffectiveness({decisions,history});
    }
  };
}
