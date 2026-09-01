import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionEffectivenessApi } from '../lib/decision-effectiveness-api.js';

function resRecorder(){ return {code:null,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}}; }

test('protects effectiveness data before read', async()=>{
  let reads=0;
  const h=createDecisionEffectivenessApi({configuredKey:'secret',readEffectiveness:async()=>{reads++;return {};}});
  const res=resRecorder();
  await h({method:'GET',headers:{}},res);
  assert.equal(res.code,403); assert.equal(reads,0);
});

test('returns read-only effectiveness aggregate', async()=>{
  const h=createDecisionEffectivenessApi({configuredKey:'secret',readEffectiveness:async()=>({recommendationCount:4,totalConfirmedEffect:1200})});
  const res=resRecorder();
  await h({method:'GET',headers:{authorization:'Bearer secret'}},res);
  assert.equal(res.code,200); assert.equal(res.body.totalConfirmedEffect,1200); assert.equal(res.headers['Cache-Control'],'no-store');
});
