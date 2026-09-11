import test from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../lib/cash-photo-recognizer.js';
const { recognizeWithFallback, CashPhotoRecognitionUnavailableError } = mod;
const key = 'test-only-gemini-key';
const models = ['gemini-3.8-flash', 'gemini-3.5-flash'];
const data = { initialBalance: 10, visibleMoneyRowCount: 0, finalBalance: 10, finalBalanceReadable: true, pageNote: '', operations: [] };
const payload = { contents: [{ role: 'user', parts: [{ text: 'Read a journal' }] }] };
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });
const success = () => response(200, { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(data) }] } }] });
const options = { apiKey: key, payload, models, sleepImpl: async () => {}, randomImpl: () => 0 };

test('missing Gemini key fails closed without any request', async () => {
  let calls = 0;
  await assert.rejects(recognizeWithFallback({ ...options, apiKey: '', fetchImpl: async () => { calls++; return success(); } }), e => {
    assert.equal(e.retryable, true);
    assert.match(e.publicMessage, /Фото сохранено/);
    assert.match(e.diagnostics.join(' '), /KEY_MISSING/);
    return true;
  });
  assert.equal(calls, 0);
});

test('uses official native endpoint with header-only key and preserved recognition JSON', async () => {
  let request;
  const result = await recognizeWithFallback({ ...options, fetchImpl: async (url, init) => { request = {url, init}; return success(); } });
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(request.init.headers['x-goog-api-key'], key);
  assert.equal(request.init.headers.authorization, undefined);
  assert.equal(request.init.redirect, 'error');
  assert.ok(request.init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(request.init.body), payload);
  assert.equal(result.model, 'gemini-3.8-flash');
  assert.deepEqual(result.data, data);
  assert.ok(!JSON.stringify([request.url, request.init.body, result]).includes(key));
});

for (const status of [429, 500, 503]) test(`HTTP ${status} retries with exponential backoff then succeeds`, async () => {
  let calls = 0; const sleeps = [];
  const result = await recognizeWithFallback({ ...options, models: models.slice(0,1), maxAttemptsPerModel: 3, baseDelayMs: 100,
    sleepImpl: async ms => sleeps.push(ms), fetchImpl: async () => ++calls < 3 ? response(status, { error: { message: key } }) : success() });
  assert.equal(calls, 3); assert.deepEqual(sleeps, [100,200]); assert.deepEqual(result.data, data);
  assert.ok(!JSON.stringify(result).includes(key));
});

test('uses fallback only after bounded transient attempts or a missing model', async () => {
  for (const status of [503,404]) {
    const calls = [];
    const result = await recognizeWithFallback({ ...options, maxAttemptsPerModel: 2, fetchImpl: async url => {
      calls.push(url); return url.includes('3.8') ? response(status, {error:{message:key}}) : success();
    }});
    assert.equal(result.model, 'gemini-3.5-flash'); assert.equal(calls.length, status === 503 ? 3 : 2);
  }
});

for (const status of [400,401,403]) test(`HTTP ${status} stops without retry, fallback or raw body leakage`, async () => {
  let calls = 0; let bodyReads = 0;
  await assert.rejects(recognizeWithFallback({ ...options, fetchImpl: async () => {
    calls++; return {ok:false,status,async json(){bodyReads++;return {error:{message:key}};}};
  }}), e => { assert.equal(e.status,status);assert.equal(e.retryable,false);assert.ok(!JSON.stringify(e).includes(key));assert.ok(!e.message.includes(key));return true; });
  assert.equal(calls,1);assert.equal(bodyReads,0);
});

test('exhausted transient and network failures return safe pending error without raw details', async () => {
  for (const network of [false,true]) {
    let calls = 0;
    await assert.rejects(recognizeWithFallback({ ...options,maxAttemptsPerModel:2,fetchImpl:async()=>{
      calls++;if(network) throw new Error(key);return response(503,{error:{message:key}});
    }}), e=>{assert.ok(e instanceof CashPhotoRecognitionUnavailableError);assert.ok(!JSON.stringify(e).includes(key));assert.ok(!e.message.includes(key));return true;});
    assert.equal(calls,4);
  }
});

test('rejects incomplete, invalid or missing operations instead of archiving success', async () => {
  for (const body of [
    {candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:JSON.stringify(data)}]}}]},
    {candidates:[{finishReason:'STOP',content:{parts:[{text:'not JSON '+key}]}}]},
    {candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]},
    {promptFeedback:{blockReason:'SAFETY'}}
  ]) await assert.rejects(recognizeWithFallback({...options,fetchImpl:async()=>response(200,body)}),e=>{
    assert.equal(e.retryable,false);assert.ok(!JSON.stringify(e).includes(key));return true;
  });
});

test('time budget stops retries before the hosting timeout and aborts slow requests', async () => {
  let elapsed = 0; let calls = 0;
  await assert.rejects(recognizeWithFallback({...options,now:()=>elapsed,totalTimeoutMs:100,requestTimeoutMs:50,
    fetchImpl:async()=>{calls++;elapsed=101;return response(503,{});}
  }), CashPhotoRecognitionUnavailableError);
  assert.equal(calls,1);
  let aborts=0;
  await assert.rejects(recognizeWithFallback({...options,models:models.slice(0,1),maxAttemptsPerModel:1,requestTimeoutMs:5,
    fetchImpl:async(_url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>{aborts++;reject(new Error(key));},{once:true}))
  }), CashPhotoRecognitionUnavailableError);
  assert.equal(aborts,1);
});

test('invalid retry/model configuration fails closed before sending the key', async () => {
  for (const extra of [{models:['google/gemini-3.8-flash']},{models:['https://invalid.example/model']},{maxAttemptsPerModel:Infinity}]) {
    let calls=0;
    await assert.rejects(recognizeWithFallback({...options,...extra,fetchImpl:async()=>{calls++;return success();}}));
    assert.equal(calls,0);
  }
});

test('model probe verifies official metadata and only returns safe availability fields', async () => {
  assert.equal(typeof mod.probeGeminiModels,'function');
  const urls=[];
  const result=await mod.probeGeminiModels({apiKey:key,models,fetchImpl:async(url,init)=>{
    urls.push(url);assert.equal(init.headers['x-goog-api-key'],key);
    return response(200,{name:urls.length===1?'models/gemini-3.8-flash':'models/gemini-3.5-flash',supportedGenerationMethods:['generateContent'],ignoredSecret:key});
  }});
  assert.equal(result.ok,true);assert.equal(result.apiKeyConfigured,true);assert.deepEqual(result.models,models);
  assert.ok(urls.every(u=>u.startsWith('https://generativelanguage.googleapis.com/v1beta/models/')));
  assert.ok(!JSON.stringify(result).includes(key));
});

test('probe fails closed for absent key, failed auth or missing generation support', async () => {
  assert.equal(typeof mod.probeGeminiModels,'function');
  let calls=0;
  const absent=await mod.probeGeminiModels({apiKey:'',models,fetchImpl:async()=>{calls++;return success();}});
  assert.equal(absent.ok,false);assert.equal(absent.apiKeyConfigured,false);assert.equal(calls,0);
  for(const status of [403,200]){
    const result=await mod.probeGeminiModels({apiKey:key,models,fetchImpl:async()=>response(status,{error:{message:key},supportedGenerationMethods:[]})});
    assert.equal(result.ok,false);assert.ok(!JSON.stringify(result).includes(key));
  }
});
