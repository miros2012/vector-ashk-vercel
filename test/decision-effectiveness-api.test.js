import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionEffectivenessApi } from '../lib/decision-effectiveness-api.js';

function responseRecorder() {
  return {
    code:null, body:null, headers:{},
    setHeader(name,value){ this.headers[name]=value; },
    status(code){ this.code=code; return this; },
    json(body){ this.body=body; return this; }
  };
}

test('authorized GET returns aggregate with no-store', async () => {
  const api = createDecisionEffectivenessApi({
    configuredKey:'secret',
    readEffectiveness: async () => ({ recommendationCount:4, totalConfirmedEffect:80000 })
  });
  const res=responseRecorder();
  await api({ method:'GET', headers:{ 'x-vector-key':'secret' } },res);
  assert.equal(res.code,200);
  assert.equal(res.headers['Cache-Control'],'no-store');
  assert.equal(res.body.ok,true);
  assert.equal(res.body.metrics.recommendationCount,4);
});

test('rejects wrong key before read', async () => {
  let reads=0;
  const api=createDecisionEffectivenessApi({ configuredKey:'secret', readEffectiveness:async()=>{ reads+=1; return {}; } });
  const res=responseRecorder();
  await api({ method:'GET', headers:{ authorization:'Bearer wrong' } },res);
  assert.equal(res.code,403);
  assert.equal(reads,0);
});

test('GET only', async () => {
  const api=createDecisionEffectivenessApi({ configuredKey:'secret', readEffectiveness:async()=>({}) });
  const res=responseRecorder();
  await api({ method:'POST', headers:{ 'x-vector-key':'secret' } },res);
  assert.equal(res.code,405);
});
