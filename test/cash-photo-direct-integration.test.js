import test from 'node:test';
import assert from 'node:assert/strict';
import { createCashPhotoStore } from '../lib/cash-photo-store.js';
import { createCashPhotoUploadService } from '../lib/cash-photo-upload-service.js';
import { createCashPhotoUploadHttpHandler } from '../lib/cash-photo-upload-http.js';
import { recognizeWithFallback } from '../lib/cash-photo-recognizer.js';
import { buildCashPhotoGeminiPayload } from '../lib/cash-photo-prompt.js';

// The real HTTP, service, recognizer and store run together. Only external
// Drive/Sheets/HTTP I/O is replaced; every write range is checked independently.
function fixture(apiKey, providerStatus) {
  const events=[]; const rows=[]; const writes=[]; const requests=[];
  const sheets={spreadsheets:{values:{
    async get(){return {data:{values:rows}};},
    async append(args){events.push('archive');writes.push(args.range);rows.push([...args.requestBody.values[0]]);return {data:{updates:{updatedRange:"'Архив кассовых фото'!A2:N2"}}};},
    async update(args){writes.push(args.range);const start=args.range.match(/!([A-Z])/)[1].charCodeAt(0)-65;args.requestBody.values[0].forEach((v,i)=>rows[0][start+i]=v);return {data:{}};}
  }}};
  const drive={files:{async create(){events.push('drive');return {data:{id:'saved-file',webViewLink:'https://drive.google.com/file/d/saved-file/view'}};}}};
  const store=createCashPhotoStore({drive,sheets,spreadsheetId:'archive-book',folderId:'photos'});
  const recognize=async input=>{
    events.push('recognize');assert.deepEqual(events.slice(0,3),['drive','archive','recognize']);
    return recognizeWithFallback({apiKey,payload:buildCashPhotoGeminiPayload(input),maxAttemptsPerModel:1,sleepImpl:async()=>{},
      fetchImpl:async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return {ok:providerStatus===200,status:providerStatus,
        async json(){return providerStatus===200?{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({initialBalance:0,visibleMoneyRowCount:1,finalBalance:100,finalBalanceReadable:true,pageNote:'Check handwriting',operations:[{date:'10.09.2026',description:'Приход',income:100,expense:0,balance:100,balanceReadable:true,confidence:80,needsReview:true,note:''}]})}]}}]}:{error:{message:'raw-private-provider-dump '+apiKey}};}};}
    });
  };
  const handler=createCashPhotoUploadHttpHandler({authorize:async token=>token==='test-branch-token'?{branch:'Ямская'}:null,uploadService:createCashPhotoUploadService({store,recognize})});
  const upload=async()=>{
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(b){this.body=b;return this;}};
    await handler({method:'POST',headers:{'x-cash-photo-token':'test-branch-token','content-type':'image/jpeg','x-cash-year':'2026','x-cash-file-name':'test.jpg'},body:Buffer.from('synthetic-test-photo')},res);return res;
  };
  return {upload,events,rows,writes,requests};
}

for(const [name,key,status] of [['missing key','',200],['transient outage','test-secret',503]])test(`${name}: saved photo returns safe 202 and remains retryable in archive`,async()=>{
  const f=fixture(key,status);const res=await f.upload();
  assert.equal(res.code,202);assert.equal(res.body.saved,true);assert.equal(res.body.pendingRecognition,true);
  assert.equal(f.rows[0][7],'Ожидает распознавания');assert.equal(f.rows.length,1);
  assert.doesNotMatch(JSON.stringify(res.body),/raw-private|test-secret|stack|HTTP|Gemini/);
  assert.ok(f.writes.every(range=>range.startsWith("'Архив кассовых фото'!")));
  if(!key)assert.equal(f.requests.length,0);
});

test('native recognition writes archive only and duplicate upload creates no new file or request',async()=>{
  const f=fixture('test-secret',200);const first=await f.upload();const again=await f.upload();
  assert.equal(first.code,200);assert.equal(first.body.rowsRecognized,1);assert.equal(first.body.reviewCount,1);
  assert.equal(again.body.alreadyStored,true);assert.equal(f.rows.length,1);assert.equal(f.requests.length,1);
  assert.equal(f.events.filter(x=>x==='drive').length,1);
  assert.equal(f.rows[0][7],'Распознано — ожидает обработки');assert.equal(f.rows[0][10],'');
  assert.equal(JSON.parse(f.rows[0][13]).operations.length,1);
  assert.ok(f.writes.every(range=>range.startsWith("'Архив кассовых фото'!")));
  assert.ok(f.requests[0].url.startsWith('https://generativelanguage.googleapis.com/'));
  assert.equal(f.requests[0].body.contents[0].parts[1].inlineData.data,Buffer.from('synthetic-test-photo').toString('base64'));
});
