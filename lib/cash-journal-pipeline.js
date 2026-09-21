import { withGoogleSheetsLease } from './google-sheets-lease.js';
import { findNextDdsRow } from './tochka-dds-import.js';

const DRAFT_SHEET = 'Черновик кассы';
const RULES_SHEET = 'Справочник кассы';
const WALLETS_SHEET = 'Кошельки наличных';
const ARTICLES_SHEET = 'Справочник статей';
const DDS_SHEET = 'ДДС: месяц';
const TRANSFER_LOG_SHEET = 'Журнал переноса кассы';
const ARCHIVE_SHEET = 'Архив кассовых фото';
const DDS_FIRST_ROW = 5;
const DDS_LAST_ROW = 30000;
const LEASE_KEY = 'tochka_dds_import_lock';
const MONTHS = ['', 'Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function text(value) { return String(value ?? '').trim(); }
function normalize(value) {
  return text(value).toUpperCase().replace(/Ё/g,'Е').replace(/\s+/g,' ').trim();
}
function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(text(value).replace(/\u00a0/g,'').replace(/\s/g,'').replace(',','.'));
  return Number.isFinite(n) ? n : 0;
}
function ruDateSerial(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const m = text(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return 0;
  return Date.UTC(Number(m[3]), Number(m[2])-1, Number(m[1])) / 86400000 + 25569;
}
function serialParts(serial) {
  const d = new Date(Date.UTC(1899,11,30) + Math.trunc(Number(serial)) * 86400000);
  return { year:d.getUTCFullYear(), month:d.getUTCMonth()+1, day:d.getUTCDate() };
}
function fingerprint(date, branch, expense, income, balance) {
  const serial = ruDateSerial(date);
  const b = normalize(branch);
  const e = numberValue(expense);
  const i = numberValue(income);
  const bal = numberValue(balance);
  if (!serial || !b || ((e>0)===(i>0)) || !Number.isFinite(bal)) return '';
  const signed = e > 0 ? -e : i;
  return [serial,b,Math.round(signed*100),Math.round(bal*100)].join('|');
}
function parseUpdatedRows(range) {
  const m=text(range).match(/![A-Z]+(\d+):[A-Z]+(\d+)$/i);
  return m ? {start:Number(m[1]),end:Number(m[2])} : null;
}
function classify(description, rules) {
  const source=normalize(description);
  for (const rule of rules) {
    try { if (new RegExp(rule.pattern,'i').test(source)) return rule; } catch {}
  }
  return {type:'Не определено',article:'',wallet:'',comment:'Требует ручной проверки'};
}
function buildRuleRows(values) {
  return (Array.isArray(values)?values:[]).map(row=>({
    priority:Number(row?.[0]||999),
    pattern:text(row?.[1]),
    type:text(row?.[2]),
    article:text(row?.[3]),
    wallet:text(row?.[4]),
    comment:text(row?.[5])
  })).filter(r=>r.pattern).sort((a,b)=>a.priority-b.priority);
}
function buildWallets(values) {
  const byName=new Map(); const branchByName=new Map();
  for (const row of Array.isArray(values)?values:[]) {
    const code=row?.[0], name=text(row?.[1]), type=text(row?.[2]), active=row?.[3];
    if (!name || active===false || text(active).toUpperCase()==='FALSE') continue;
    byName.set(normalize(name),code);
    if (normalize(type)==='ФИЛИАЛ') {
      const branch=name.replace(/^Касса\s+/i,'').trim();
      branchByName.set(normalize(branch),name);
    }
  }
  return {byName,branchByName};
}
function buildActivities(values) {
  const map=new Map();
  for (const row of Array.isArray(values)?values:[]) {
    const article=text(row?.[0]); if(article) map.set(normalize(article),text(row?.[1])||'Операционная');
  }
  return map;
}
function existingFingerprints(rows) {
  const map=new Map();
  for (let i=0;i<(Array.isArray(rows)?rows.length:0);i++) {
    const row=rows[i]||[];
    const fp=fingerprint(row[1],row[2],row[4],row[5],row[6]);
    if(fp) map.set(fp,{row:i+2,id:text(row[0]),status:text(row[12])});
  }
  return map;
}
function ddsCashId(comment) {
  const m=text(comment).match(/^Касса Vercel \| ([^|]+?)(?::\d+\/\d+)?(?: \||$)/);
  return m ? m[1].trim() : '';
}
function hasAnyValue(rows) {
  return (Array.isArray(rows)?rows:[]).some(row=>(Array.isArray(row)?row:[]).some(v=>text(v)!==''));
}

export function buildCashDraftRows({photo,data,rules,wallets,existingRows}={}) {
  const operations=Array.isArray(data?.operations)?data.operations:[];
  const existing=existingFingerprints(existingRows);
  const rows=[]; const meta=[];
  let previous=Number(data?.initialBalance);
  if(!Number.isFinite(previous)) previous=NaN;

  operations.forEach((op,index)=>{
    const date=ruDateSerial(op?.date);
    const branch=text(photo?.branch);
    const description=text(op?.description);
    const expense=Math.max(0,numberValue(op?.expense));
    const income=Math.max(0,numberValue(op?.income));
    const balance=numberValue(op?.balance);
    const readable=op?.balanceReadable===true && Number.isFinite(balance);
    const fp=fingerprint(date,branch,expense,income,readable?balance:'');
    if(fp && existing.has(fp)) {
      meta.push({index,duplicate:true,status:'Дубль — уже учтено',existing:existing.get(fp)});
      if(readable) previous=balance;
      return;
    }

    const errors=[];
    if(!date) errors.push('нет даты');
    if(!branch) errors.push('нет филиала');
    if(!description) errors.push('нет описания');
    if((expense>0 && income>0)||(expense<=0 && income<=0)) errors.push('заполните только расход или приход');
    if(!readable) errors.push('нет остатка по журналу');
    if(Number(op?.confidence||0)<85) errors.push('уверенность ИИ ниже 85%');
    if(op?.needsReview===true) errors.push('ИИ просит проверить распознавание');

    let rule=classify(description,rules);
    let type=rule.type;
    if(type!=='Инкассация') {
      if(expense>0 && income<=0) type='Расход';
      else if(income>0 && expense<=0) type='Приход';
    }
    const article=type==='Инкассация'?'':text(rule.article);
    if(type==='Не определено') errors.push('не определён тип');
    if((type==='Приход'||type==='Расход')&&!article) errors.push('не определена статья');

    const branchWallet=wallets.branchByName.get(normalize(branch))||`Касса ${branch}`;
    let fromWallet='',toWallet='';
    if(type==='Приход') toWallet=branchWallet;
    else if(type==='Расход') fromWallet=branchWallet;
    else if(type==='Инкассация') { fromWallet=branchWallet; toWallet=text(rule.wallet); }
    if((fromWallet && !wallets.byName.has(normalize(fromWallet)))||(toWallet && !wallets.byName.has(normalize(toWallet)))) {
      errors.push('кошелёк не найден или неактивен');
    }

    let balanceCheck='Первая строка фото';
    if(readable && Number.isFinite(previous)) {
      const expected=previous-expense+income;
      const diff=Math.round((balance-expected)*100)/100;
      if(Math.abs(diff)<0.01) balanceCheck='Сходится';
      else if(Math.abs(diff)<=1) balanceCheck=`Сходится (округление: ${diff} ₽)`;
      else { balanceCheck=`Расхождение: ${diff} ₽`; errors.push('арифметика журнала не сходится'); }
    }
    if(readable) previous=balance;

    const id=`${text(photo?.photoId)}:op${index+1}`;
    const status=errors.length?'Проверить':'Готово к переносу';
    const comment=[
      '[VERCEL-OCR]',
      `Фото-ID: ${text(photo?.photoId)}`,
      Number.isFinite(Number(op?.confidence)) ? `Уверенность ${Math.round(Number(op.confidence))}%` : '',
      errors.length ? `Автопроверка: ${errors.join('; ')}` : (rule.comment ? `Автопроверка: ${rule.comment}` : '')
    ].filter(Boolean).join(' | ');
    rows.push([
      id,date,branch,description||'[неразборчиво]',
      expense>0?expense:'',income>0?income:'',readable?balance:'',
      type,article,fromWallet,toWallet,balanceCheck,status,comment
    ]);
    if(fp) existing.set(fp,{row:null,id,status});
    meta.push({index,duplicate:false,id,status});
  });
  return {rows,meta,readyCount:meta.filter(x=>!x.duplicate&&x.status==='Готово к переносу').length,
    reviewCount:meta.filter(x=>!x.duplicate&&x.status==='Проверить').length,
    duplicateCount:meta.filter(x=>x.duplicate).length};
}

export function createCashJournalPipeline({sheets,spreadsheetId,now=()=>new Date()}={}) {
  const values=sheets?.spreadsheets?.values;
  if(!values?.get||!values?.append||!values?.update) throw new Error('Google Sheets values client is required');
  if(!spreadsheetId) throw new Error('spreadsheetId is required');

  async function stage(photo,data) {
    const [draftResp,rulesResp,walletResp]=await Promise.all([
      values.get({spreadsheetId,range:`'${DRAFT_SHEET}'!A2:N`,valueRenderOption:'UNFORMATTED_VALUE'}),
      values.get({spreadsheetId,range:`'${RULES_SHEET}'!A2:F`,valueRenderOption:'UNFORMATTED_VALUE'}),
      values.get({spreadsheetId,range:`'${WALLETS_SHEET}'!A2:E`,valueRenderOption:'UNFORMATTED_VALUE'})
    ]);
    const rules=buildRuleRows(rulesResp?.data?.values||[]);
    const wallets=buildWallets(walletResp?.data?.values||[]);
    if (!wallets.branchByName.has(normalize(photo?.branch))) {
      return {
        rows: [],
        meta: [],
        readyCount: 0,
        reviewCount: 0,
        duplicateCount: 0,
        startRow: 0,
        endRow: 0,
        wallets,
        skippedInactiveBranch: true
      };
    }
    const built=buildCashDraftRows({photo,data,rules,wallets,existingRows:draftResp?.data?.values||[]});
    if(!built.rows.length) return {...built,startRow:0,endRow:0,wallets};
    const appended=await values.append({
      spreadsheetId,range:`'${DRAFT_SHEET}'!A:N`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',
      requestBody:{values:built.rows}
    });
    const span=parseUpdatedRows(appended?.data?.updates?.updatedRange);
    if(!span) throw new Error('Cash draft append did not return row range');
    return {...built,startRow:span.start,endRow:span.end,wallets};
  }

  async function transferReady(staged) {
    if(!staged?.rows?.length||!staged?.startRow) return {operations:0,ddsRows:0};
    const ready=[];
    staged.rows.forEach((row,index)=>{ if(text(row[12])==='Готово к переносу') ready.push({row,rowNumber:staged.startRow+index}); });
    if(!ready.length) return {operations:0,ddsRows:0};

    return withGoogleSheetsLease({
      sheets,spreadsheetId,key:LEASE_KEY,
      run:async()=>{
        const [logResp,walletResp,articleResp,ddsCommentsResp,anchorResp]=await Promise.all([
          values.get({spreadsheetId,range:`'${TRANSFER_LOG_SHEET}'!A2:H`,valueRenderOption:'UNFORMATTED_VALUE'}),
          values.get({spreadsheetId,range:`'${WALLETS_SHEET}'!A2:E`,valueRenderOption:'UNFORMATTED_VALUE'}),
          values.get({spreadsheetId,range:`'${ARTICLES_SHEET}'!A2:B`,valueRenderOption:'UNFORMATTED_VALUE'}),
          values.get({spreadsheetId,range:`'${DDS_SHEET}'!M${DDS_FIRST_ROW}:M${DDS_LAST_ROW}`,valueRenderOption:'UNFORMATTED_VALUE'}),
          values.get({spreadsheetId,range:`'${DDS_SHEET}'!A${DDS_FIRST_ROW}:A${DDS_LAST_ROW}`,valueRenderOption:'UNFORMATTED_VALUE'})
        ]);
        const transferred=new Set((logResp?.data?.values||[]).map(r=>text(r?.[0])).filter(Boolean));
        const ddsCounts=new Map();
        for(const r of ddsCommentsResp?.data?.values||[]) {
          const id=ddsCashId(r?.[0]); if(id) ddsCounts.set(id,(ddsCounts.get(id)||0)+1);
        }
        const wallets=buildWallets(walletResp?.data?.values||[]);
        const activities=buildActivities(articleResp?.data?.values||[]);
        const ddsRows=[]; const source=[];
        for(const item of ready) {
          const row=item.row; const id=text(row[0]); const type=text(row[7]);
          if(!id) continue;
          const expectedParts=type==='Инкассация'?2:1;
          if(transferred.has(id)||Number(ddsCounts.get(id)||0)>=expectedParts) {
            await values.update({spreadsheetId,range:`'${DRAFT_SHEET}'!M${item.rowNumber}:N${item.rowNumber}`,
              valueInputOption:'RAW',requestBody:{values:[['Перенесено','Восстановлено по идемпотентному маркеру ДДС']]}});
            continue;
          }
          const date=Number(row[1]); const parts=serialParts(date); const month=parts.month;
          const expense=numberValue(row[4]); const income=numberValue(row[5]);
          const article=text(row[8]); const from=text(row[9]); const to=text(row[10]); const desc=text(row[3]); const branch=text(row[2]);
          const activity=activities.get(normalize(article))||'Операционная';
          const make=(amount,walletCode,counterparty,description,a,flow,act,part,total)=>[
            MONTHS[month],month,date,amount,walletCode,'',counterparty||'',description||'',a||'',flow||'',act||'',month,
            `Касса Vercel | ${id}${total>1?`:${part}/${total}`:''} | ${text(branch)}`
          ];
          if(type==='Инкассация') {
            const amount=expense>0?expense:income;
            const fromCode=wallets.byName.get(normalize(from)); const toCode=wallets.byName.get(normalize(to));
            if(!fromCode||!toCode) continue;
            ddsRows.push(make(-amount,fromCode,to,`${desc} — перевод из ${from}`,'','Выбытие','',1,2));
            ddsRows.push(make(amount,toCode,from,`${desc} — поступление в ${to}`,'','Поступление','',2,2));
            source.push({...item,id,type,count:2});
          } else if(type==='Расход') {
            const code=wallets.byName.get(normalize(from)); if(!code||!article) continue;
            ddsRows.push(make(-expense,code,'',`${desc} [${branch}]`,article,'Выбытие',activity,1,1));
            source.push({...item,id,type,count:1});
          } else if(type==='Приход') {
            const code=wallets.byName.get(normalize(to)); if(!code||!article) continue;
            ddsRows.push(make(income,code,'',`${desc} [${branch}]`,article,'Поступление',activity,1,1));
            source.push({...item,id,type,count:1});
          }
        }
        if(!ddsRows.length) return {operations:0,ddsRows:0};

        const start=findNextDdsRow(anchorResp?.data?.values||[],DDS_FIRST_ROW);
        const end=start+ddsRows.length-1;
        if(end>DDS_LAST_ROW) throw new Error('Cash DDS target capacity exceeded');
        const target=await values.get({spreadsheetId,range:`'${DDS_SHEET}'!A${start}:S${end}`,valueRenderOption:'UNFORMATTED_VALUE'});
        if(hasAnyValue(target?.data?.values||[])) throw new Error('Cash DDS target rows are not empty');
        await values.update({spreadsheetId,range:`'${DDS_SHEET}'!A${start}:M${end}`,valueInputOption:'RAW',requestBody:{values:ddsRows}});

        const verify=await values.get({spreadsheetId,range:`'${DDS_SHEET}'!M${start}:M${end}`,valueRenderOption:'UNFORMATTED_VALUE'});
        const verified=new Map();
        for(const r of verify?.data?.values||[]) { const id=ddsCashId(r?.[0]); if(id) verified.set(id,(verified.get(id)||0)+1); }
        for(const s of source) if(Number(verified.get(s.id)||0)!==s.count) throw new Error('Cash DDS readback verification failed');

        const logRows=[]; let cursor=start; const stamp=now() instanceof Date?now().toISOString():new Date(now()).toISOString();
        for(const s of source) {
          const first=cursor,last=cursor+s.count-1;
          await values.update({spreadsheetId,range:`'${DRAFT_SHEET}'!M${s.rowNumber}:N${s.rowNumber}`,valueInputOption:'RAW',
            requestBody:{values:[['Перенесено',`Автоматически перенесено Vercel в ДДС, строки ${first}–${last}`]]}});
          logRows.push([s.id,stamp,s.rowNumber,s.type,s.count,first,last,'Успешно — Vercel OCR']);
          cursor=last+1;
        }
        if(logRows.length) await values.append({spreadsheetId,range:`'${TRANSFER_LOG_SHEET}'!A:H`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',requestBody:{values:logRows}});
        return {operations:source.length,ddsRows:ddsRows.length,firstDDSRow:start,lastDDSRow:end};
      }
    });
  }

  return {
    async syncRecognition(photo,data) {
      const staged=await stage(photo,data);
      const transfer=await transferReady(staged);
      return {
        newRows:staged.rows.length,
        readyCount:staged.readyCount,
        reviewCount:staged.reviewCount,
        duplicateCount:staged.duplicateCount,
        transferredOperations:transfer.operations||0,
        createdDDSRows:transfer.ddsRows||0,
        skippedInactiveBranch:staged.skippedInactiveBranch===true
      };
    }
  };
}
