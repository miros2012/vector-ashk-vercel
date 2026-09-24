import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashDraftRows, createCashJournalPipeline } from '../lib/cash-journal-pipeline.js';

const rules=[
  [30,'ОПЛАТА.*ОБУЧЕН|ОБУЧЕН.*ОПЛАТА|ОБУЧЕН','Приход','Продажи','','Наличная оплата курсанта'],
  [40,'КОФЕ|САХАР|КОНФЕТ','Расход','Содержание офиса','','Офисные расходы'],
  [999,'.*','Не определено','','','Требует ручной проверки']
];
const wallets=[
  [103,'Касса Зарека','Филиал',true,''],
  [201,'Мирослав','Подотчёт',true,''],
  [202,'Вадим','Подотчёт',true,'']
];
const articles=[
  ['Продажи','Операционная'],
  ['Содержание офиса','Операционная']
];

function makeSheets(){
  const state={
    draft:[], dds:[], log:[], lease:[['tochka_dds_import_lock','IDLE']],
    rules, wallets, articles
  };
  function rangeText(args){return String(args.range||'');}
  const values={
    async get(args){
      const r=rangeText(args);
      if(r.includes("'Черновик кассы'!A2:N")) return {data:{values:state.draft}};
      if(r.includes("'Справочник кассы'!A2:F")) return {data:{values:state.rules}};
      if(r.includes("'Кошельки наличных'!A2:E")) return {data:{values:state.wallets}};
      if(r.includes("'Справочник статей'!A2:B")) return {data:{values:state.articles}};
      if(r.includes("'Журнал переноса кассы'!A2:H")) return {data:{values:state.log}};
      if(r.includes("'ДДС: месяц'!M5:M30000")) return {data:{values:state.dds.map(row=>[row[12]])}};
      if(r.includes("'ДДС: месяц'!A5:A30000")) return {data:{values:state.dds.map(row=>[row[0]])}};
      if(r.includes("'__vercel_control'!A:B")) return {data:{values:state.lease}};
      const target=r.match(/'ДДС: месяц'!A(\d+):S(\d+)/);
      if(target){
        const start=Number(target[1]), end=Number(target[2]), out=[];
        for(let row=start;row<=end;row++){
          const idx=row-5;
          out.push(state.dds[idx]||[]);
        }
        return {data:{values:out}};
      }
      const verify=r.match(/'ДДС: месяц'!M(\d+):M(\d+)/);
      if(verify){
        const start=Number(verify[1]), end=Number(verify[2]), out=[];
        for(let row=start;row<=end;row++){
          const idx=row-5;
          out.push([state.dds[idx]?.[12]||'']);
        }
        return {data:{values:out}};
      }
      return {data:{values:[]}};
    },
    async append(args){
      const r=rangeText(args), rows=args.requestBody.values;
      if(r.includes("'Черновик кассы'!A:N")){
        const start=state.draft.length+2;
        state.draft.push(...rows.map(row=>[...row]));
        return {data:{updates:{updatedRange:`'Черновик кассы'!A${start}:N${start+rows.length-1}`}}};
      }
      if(r.includes("'Журнал переноса кассы'!A:H")){
        state.log.push(...rows.map(row=>[...row]));
        return {data:{updates:{updatedRange:"'Журнал переноса кассы'!A2:H2"}}};
      }
      throw new Error('unexpected append '+r);
    },
    async update(args){
      const r=rangeText(args), rows=args.requestBody.values;
      const dds=r.match(/'ДДС: месяц'!A(\d+):M(\d+)/);
      if(dds){
        const start=Number(dds[1]);
        rows.forEach((row,i)=>{state.dds[start-5+i]=[...row];});
        return {data:{}};
      }
      const draft=r.match(/'Черновик кассы'!M(\d+):N(\d+)/);
      if(draft){
        const row=Number(draft[1])-2;
        state.draft[row][12]=rows[0][0];
        state.draft[row][13]=rows[0][1];
        return {data:{}};
      }
      const draftReclass=r.match(/'Черновик кассы'!H(\d+):N(\d+)/);
      if(draftReclass){
        const row=Number(draftReclass[1])-2;
        for(let i=0;i<7;i++) state.draft[row][7+i]=rows[0][i];
        return {data:{}};
      }
      throw new Error('unexpected update '+r);
    }
  };
  const sheets={spreadsheets:{
    values,
    async get(){return {data:{sheets:[{properties:{sheetId:999,title:'__vercel_control'}}]}};},
    async batchUpdate(args){
      const fr=args.requestBody.requests[0].findReplace;
      const expected=fr.find,replacement=fr.replacement;
      if(state.lease[0][1]===expected){state.lease[0][1]=replacement;return {data:{replies:[{findReplace:{occurrencesChanged:1}}]}};}
      return {data:{replies:[{findReplace:{occurrencesChanged:0}}]}};
    }
  }};
  return {sheets,state};
}

test('buildCashDraftRows deduplicates overlapping journal operations by date branch amount and balance',()=>{
  const built=buildCashDraftRows({
    photo:{photoId:'PHOTO-new',branch:'Зарека'},
    data:{initialBalance:6002,operations:[{date:'18.09.2026',description:'Макаров обучение',income:10000,expense:0,balance:16002,balanceReadable:true,confidence:100,needsReview:false}]},
    rules:rules.map(r=>({priority:r[0],pattern:r[1],type:r[2],article:r[3],wallet:r[4],comment:r[5]})),
    wallets:{byName:new Map([['КАССА ЗАРЕКА',103]]),branchByName:new Map([['ЗАРЕКА','Касса Зарека']])},
    existingRows:[['old','18.09.2026','Зарека','старое', '',10000,16002,'Приход','Продажи','','Касса Зарека','','Перенесено','']]
  });
  assert.equal(built.rows.length,0);
  assert.equal(built.duplicateCount,1);
});

test('clear recognized cash operation stages and transfers to DDS exactly once',async()=>{
  const {sheets,state}=makeSheets();
  const pipeline=createCashJournalPipeline({sheets,spreadsheetId:'book',now:()=>new Date('2026-09-21T16:00:00Z')});
  const photo={photoId:'PHOTO-Z',branch:'Зарека'};
  const data={initialBalance:6002,operations:[
    {date:'18.09.2026',description:'Макаров обучение',income:10000,expense:0,balance:16002,balanceReadable:true,confidence:100,needsReview:false}
  ]};
  const first=await pipeline.syncRecognition(photo,data);
  assert.equal(first.newRows,1);
  assert.equal(first.readyCount,1);
  assert.equal(first.transferredOperations,1);
  assert.equal(first.createdDDSRows,1);
  assert.equal(state.draft.length,1);
  assert.equal(state.draft[0][12],'Перенесено');
  assert.equal(state.dds.length,1);
  assert.equal(state.dds[0][3],10000);
  assert.equal(state.dds[0][4],103);
  assert.equal(state.dds[0][8],'Продажи');
  assert.match(state.dds[0][12],/^Касса Vercel \| PHOTO-Z:op1/);
  assert.equal(state.log.length,1);

  const second=await pipeline.syncRecognition(photo,data);
  assert.equal(second.newRows,0);
  assert.equal(second.duplicateCount,1);
  assert.equal(state.dds.length,1);
  assert.equal(state.log.length,1);
});

test('ambiguous recognized operation stays in review and never reaches DDS',async()=>{
  const {sheets,state}=makeSheets();
  const pipeline=createCashJournalPipeline({sheets,spreadsheetId:'book'});
  const result=await pipeline.syncRecognition({photoId:'PHOTO-A',branch:'Зарека'},{
    initialBalance:16002,
    operations:[{date:'21.09.2026',description:'Непонятная выплата',expense:5000,income:0,balance:11002,balanceReadable:true,confidence:100,needsReview:false}]
  });
  assert.equal(result.newRows,1);
  assert.equal(result.reviewCount,1);
  assert.equal(result.transferredOperations,0);
  assert.equal(state.draft[0][12],'Проверить');
  assert.equal(state.dds.length,0);
});


test('partial DDS commit is recovered without duplicating money', async()=>{
  const {sheets,state}=makeSheets();
  const pipeline=createCashJournalPipeline({sheets,spreadsheetId:'book',now:()=>new Date('2026-09-22T03:00:00Z')});
  state.draft.push([
    'PHOTO-Z:op1',46283,'Зарека','Макаров обучение','',10000,16002,
    'Приход','Продажи','','Касса Зарека','Сходится','Готово к переносу',
    '[VERCEL-OCR] | Фото-ID: PHOTO-Z | Уверенность 100%'
  ]);
  state.dds.push([
    'Сентябрь',9,46283,10000,103,'','','Макаров обучение [Зарека]','Продажи',
    'Поступление','Операционная',9,'Касса Vercel | PHOTO-Z:op1 | Зарека'
  ]);

  const result=await pipeline.syncRecognition({photoId:'PHOTO-Z',branch:'Зарека'},{
    initialBalance:6002,
    operations:[{date:'18.09.2026',description:'Макаров обучение',income:10000,expense:0,balance:16002,balanceReadable:true,confidence:100,needsReview:false}]
  });

  assert.equal(result.newRows,0);
  assert.equal(result.duplicateCount,1);
  assert.equal(result.createdDDSRows,0);
  assert.equal(result.recoveredOperations,1);
  assert.equal(state.dds.length,1);
  assert.equal(state.draft[0][12],'Перенесено');
  assert.equal(state.log.length,1);
  assert.equal(state.log[0][0],'PHOTO-Z:op1');
  assert.match(state.log[0][7],/audit trail/i);
});


test('historical recognized backfill stages safe rows but never writes DDS', async()=>{
  const {sheets,state}=makeSheets();
  const pipeline=createCashJournalPipeline({sheets,spreadsheetId:'book',now:()=>new Date('2026-09-22T04:00:00Z')});
  const result=await pipeline.syncRecognition({photoId:'PHOTO-HIST',branch:'Зарека'},{
    initialBalance:6002,
    operations:[{
      date:'18.09.2026',description:'Макаров обучение',income:10000,expense:0,
      balance:16002,balanceReadable:true,confidence:100,needsReview:false
    }]
  }, { allowTransfer: false });

  assert.equal(result.newRows,1);
  assert.equal(result.readyCount,1);
  assert.equal(result.transferredOperations,0);
  assert.equal(result.createdDDSRows,0);
  assert.equal(state.draft.length,1);
  assert.equal(state.draft[0][12],'Готово к переносу');
  assert.equal(state.dds.length,0);
  assert.equal(state.log.length,0);
});


test('reconciliation promotes obvious household expense and transfers it to DDS', async()=>{
  const {sheets,state}=makeSheets();
  state.draft.push([
    'PHOTO-S:op12',46287,'Зарека','Конфеты, бумага салфетки',482,'',2908,
    'Расход','','Касса Зарека','','Сходится','Проверить',
    '[VERCEL-OCR] | Фото-ID: PHOTO-S | Уверенность 95% | Автопроверка: не определена статья'
  ]);
  const pipeline=createCashJournalPipeline({sheets,spreadsheetId:'book',now:()=>new Date('2026-09-24T10:00:00Z')});
  const result=await pipeline.reconcileDraftBacklog(100);
  assert.equal(result.promoted,1);
  assert.equal(result.transferredOperations,1);
  assert.equal(result.createdDDSRows,1);
  assert.equal(state.draft[0][8],'Содержание офиса');
  assert.equal(state.draft[0][12],'Перенесено');
  assert.equal(state.dds.length,1);
  assert.equal(state.dds[0][3],-482);
  assert.equal(state.dds[0][8],'Содержание офиса');
});

test('reconciliation keeps hard OCR or arithmetic issue for owner review', async()=>{
  const {sheets,state}=makeSheets();
  state.draft.push([
    'PHOTO-HARD:op1',46288,'Зарека','Непонятная выплата',3400,'',34327,
    'Расход','','Касса Зарека','','Расхождение: -100 ₽','Проверить',
    '[VERCEL-OCR] | Фото-ID: PHOTO-HARD | Уверенность 70% | Автопроверка: уверенность ИИ ниже 85%; ИИ просит проверить распознавание; арифметика журнала не сходится'
  ]);
  const pipeline=createCashJournalPipeline({sheets,spreadsheetId:'book'});
  const result=await pipeline.reconcileDraftBacklog(100);
  assert.equal(result.promoted,0);
  assert.equal(result.unresolved,1);
  assert.equal(result.transferredOperations,0);
  assert.equal(state.draft[0][12],'Проверить');
  assert.equal(state.dds.length,0);
});

test('reconciliation removes stale review duplicate of already transferred operation', async()=>{
  const {sheets,state}=makeSheets();
  state.draft.push([
    'PHOTO-OLD:op1',46280,'Зарека','Инкассация Мирослав',100000,'',4654,
    'Инкассация','','Касса Зарека','Мирослав','Сходится','Перенесено','done'
  ]);
  state.draft.push([
    'PHOTO-NEW:op1',46280,'Зарека','Инкассация Мирослав',100000,'',4654,
    'Инкассация','','Касса Зарека','Мирослав','Сходится','Проверить',
    '[VERCEL-OCR] | Фото-ID: PHOTO-NEW | Уверенность 95%'
  ]);
  const pipeline=createCashJournalPipeline({sheets,spreadsheetId:'book'});
  const result=await pipeline.reconcileDraftBacklog(100);
  assert.equal(result.duplicates,1);
  assert.equal(state.draft[1][12],'Дубль — уже учтено');
  assert.equal(state.dds.length,0);
});
