import { createHash } from 'node:crypto';

const norm = value => String(value ?? '').trim().replace(/[\s\u00a0\u202f]+/g, ' ').toUpperCase();
const money = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw Error('Invalid report amount');
  return Number(s);
};
export const PNL_LABELS = ['Выручка по начислению','Возвраты курсантам','Прочие операционные доходы',
  'Чистая выручка','Переменные расходы','Валовая прибыль','Постоянные расходы','Налоги',
  'Операционная прибыль','Рентабельность','Справочно: инвестиционный отток (нетто, ДДС)'];
const groups = ['ПЕРЕМЕННЫЕ РАСХОДЫ','ПОСТОЯННЫЕ РАСХОДЫ','НАЛОГИ','УМЕНЬШЕНИЕ ВЫРУЧКИ','ПРОЧИЕ ДОХОДЫ','ВЫРУЧКА'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function effectiveMonth(row) {
  const pnlMonth=Number(row?.[11]);
  return pnlMonth>=1&&pnlMonth<=12?pnlMonth:Number(row?.[1]);
}
function cashTransferPart(row) {
  const match=String(row?.[12]||'').match(/^Касса Vercel \| (.+):([12])\/2 \| /);
  const operationId=String(match?.[1]||'').trim();
  return match&&operationId?{operationId,part:Number(match[2]),total:2}:null;
}
function isPairedCashTransfer(row,next,amount) {
  if (!next || norm(row?.[8]) || norm(next?.[8]) || amount>=0) return false;
  const structurallyPaired=String(row?.[2])===String(next?.[2])
    && Number(row?.[4])>0 && Number(next?.[4])>0 && Number(row?.[4])!==Number(next?.[4])
    && Math.round(money(next?.[3])*100)===-Math.round(amount*100);
  if (!structurallyPaired) return false;
  const first=cashTransferPart(row),second=cashTransferPart(next);
  if (first || second) {
    return Boolean(first && second && first.operationId===second.operationId
      && first.part===1 && second.part===2 && first.total===2 && second.total===2
      && effectiveMonth(row)===effectiveMonth(next));
  }
  const purpose=String(row?.[7]||'').match(/^(Инкассация .+) — перевод из /);
  return Boolean(purpose && String(next?.[7]||'').startsWith(`${purpose[1]} — поступление в `)
    && Number(row?.[1])===Number(next?.[1])
    && String(row?.[11]||'')===String(next?.[11]||''));
}
function reportError(error,fallback) {
  const status=Number(error?.response?.status ?? error?.code);
  const transient=[429,500,502,503,504].includes(status)
    || ['ETIMEDOUT','ECONNRESET','EAI_AGAIN'].includes(error?.code)
    || ['TimeoutError','AbortError'].includes(error?.name)
    || error?.message==='Google Sheets request timed out';
  const errorClass=transient?'REPORT_TRANSPORT':fallback;
  console.error({event:'finance-report-failure',errorClass,...(Number.isInteger(status)&&status>=400&&status<=599?{status}: {})});
  return {ok:false,errorClass};
}

export function calculateFinanceReports({ dds, directory, revenue, layout }) {
  if (!dds?.length || !directory?.length || !revenue?.length) throw Error('Empty report source');
  if (JSON.stringify(layout) !== JSON.stringify(PNL_LABELS)) throw Error('Unexpected P&L layout');
  if (norm(directory[0]?.[0]) !== 'СТАТЬЯ' || norm(directory[0]?.[2]) !== 'УЧИТЫВАТЬ В P&L') throw Error('Invalid directory header');
  const articles = new Map();
  for (const r of directory.slice(1)) {
    if (!norm(r[0])) continue;
    const item = { include: norm(r[2]) === 'ДА', group: norm(r[4]) };
    if (!['ДА','НЕТ'].includes(norm(r[2])) || (item.include && !groups.includes(item.group))) throw Error('Invalid directory group');
    const old = articles.get(norm(r[0]));
    if (old && JSON.stringify(old) !== JSON.stringify(item)) throw Error('Conflicting directory article');
    articles.set(norm(r[0]), item);
  }
  const sums = Array.from({length:12},()=>Object.fromEntries([...groups,'INVESTMENT'].map(g=>[g,0])));
  let count=0;
  for (let index=0;index<dds.length;index++) {
    const r=dds[index];
    if (r[3] === '' || r[3] == null) continue;
    const amount = money(r[3]); if (!amount) continue;
    let month = Number(r[11]); if (!(month >=1 && month<=12)) month=Number(r[1]);
    if (!Number.isInteger(month) || month<1 || month>12) throw Error('Invalid report month');
    const item = articles.get(norm(r[8]));
    if (!item) {
      const next=dds[index+1];
      const paired=isPairedCashTransfer(r,next,amount);
      if (!paired) throw Error('Unknown report article');
      index++;continue;
    }
    const cents=Math.round(amount*100); const bucket=sums[month-1];count++;
    if (norm(r[10]) === 'ИНВЕСТИЦИОННАЯ') bucket.INVESTMENT-=cents;
    if (item.include) bucket[item.group]+=item.group==='ПРОЧИЕ ДОХОДЫ'?cents:-cents;
  }
  if (!count) throw Error('Empty report transactions');
  const header=revenue[0].map(norm);
  const monthColumn=header.findIndex(v=>['НОМЕР МЕСЯЦА','МЕСЯЦ (ЦИФРОЙ)'].includes(v));
  const revenueColumn=header.findIndex(v=>['ВЫРУЧКА АШК','ВЫРУЧКА'].includes(v));
  if (monthColumn<0 || revenueColumn<0) throw Error('Invalid revenue header');
  const revenues=Array(12).fill(null), seen=new Set();
  for(const r of revenue.slice(1)) {
    if (r.every(v=>v==null || v==='')) continue;
    const m=Number(r[monthColumn]);if(!Number.isInteger(m)||m<1||m>12||seen.has(m))throw Error('Invalid revenue month');
    seen.add(m);const v=r[revenueColumn];if(v!==''&&v!=null)revenues[m-1]=Math.round(money(v)*100);
  }
  const values=Array.from({length:11},()=>Array(12).fill(''));
  for(let m=0;m<12;m++) {
    const b=sums[m], gross=revenues[m], ret=b['УМЕНЬШЕНИЕ ВЫРУЧКИ'], other=b['ПРОЧИЕ ДОХОДЫ'];
    const net=gross===null?null:gross-ret+other;
    const variable=b['ПЕРЕМЕННЫЕ РАСХОДЫ'], fixed=b['ПОСТОЯННЫЕ РАСХОДЫ'], taxes=b['НАЛОГИ'];
    const profit=net===null?null:net-variable-fixed-taxes;
    const column=[gross,ret,other,net,variable,net===null?null:net-variable,fixed,taxes,profit,null,b.INVESTMENT];
    column.forEach((v,i)=>{values[i][m]=v===null?'':v/100;});
    values[9][m]=net && profit!==null?profit/net:'';
  }
  return { values, fingerprint:digest({dds,directory,revenue}), rows:count };
}

export async function refreshFinanceReports(adapter) {
  try {
    const first=calculateFinanceReports(await adapter.read());
    await adapter.write(first.values);
    const output=await adapter.readOutput();
    const last=calculateFinanceReports(await adapter.read());
    if (last.fingerprint!==first.fingerprint) return {ok:false,errorClass:'SOURCE_CHANGED'};
    const matches=outputMatches(first.values,output);
    return matches?{ok:true,verified:true,fingerprint:first.fingerprint,rows:first.rows}:{ok:false,errorClass:'READBACK_MISMATCH'};
  } catch(error) { return reportError(error,'REPORT_VALIDATION'); }
}

const outputMatches = (values, output) => values.every((row,i)=>row.every((v,j)=>v===''?(output[i]?.[j]??'')==='':
      typeof output[i]?.[j]==='number' && Math.abs(output[i][j]-v)<(i===9?1e-10:0.005)));
export async function verifyFinanceReports(adapter,fingerprint) {
  try {
    if(!/^[a-f0-9]{64}$/.test(fingerprint||''))return {ok:false,errorClass:'REPORT_STALE'};
    const source=calculateFinanceReports(await adapter.read());
    if(source.fingerprint!==fingerprint)return {ok:false,errorClass:'REPORT_STALE'};
    const output=await adapter.readOutput();
    return outputMatches(source.values,output)?{ok:true,verified:true,fingerprint}:{ok:false,errorClass:'REPORT_STALE'};
  } catch(error) {return reportError(error,'REPORT_UNAVAILABLE');}
}
