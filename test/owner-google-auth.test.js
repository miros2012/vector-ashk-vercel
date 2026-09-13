import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOwnerGoogleApi, googleSessionSecret } from '../lib/owner-google-auth.js';
import { createOwnerDashboardApi } from '../lib/owner-dashboard-api.js';
import { issueSession, verifySession } from '../lib/owner-dashboard-session.js';
const secret='a-dedicated-owner-secret-at-least-32-characters';
const clientId='123456789-example.apps.googleusercontent.com';
const email='owner@gmail.com';
const ownerHash=createHash('sha256').update(email).digest('hex');
const now=Date.parse('2026-09-13T10:00:00Z');
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(b){this.body=b;return this;}});
const request=(method='GET',extra={})=>({method,headers:{host:'owner.example',origin:'https://owner.example'},...extra});
function setup(overrides={}){let nonce;let checks=0;let clock=now;const api=createOwnerGoogleApi({secret,clientId,ownerHash,now:()=>clock,verifyIdToken:async()=>{checks++;return {sub:'google-owner-id',aud:clientId,iss:'https://accounts.google.com',exp:Math.floor(now/1000)+3600,email,email_verified:true,nonce,...overrides};}});return {api,setNonce:n=>nonce=n,checks:()=>checks,setClock:n=>clock=n};}
async function challenge(s){const r=response();await s.api(request(),r);assert.equal(r.code,200);s.setNonce(r.body.nonce);return r;}
test('configuration without client keeps existing access; configured challenge hides secret and owner',async()=>{
 const api=createOwnerGoogleApi({secret,clientId:'',ownerHash});const r=response();await api(request(),r);assert.deepEqual(r.body,{enabled:false});
 const s=setup();const c=await challenge(s);assert.equal(c.body.clientId,clientId);assert.equal(c.headers['Cache-Control'],'no-store');assert.ok(!JSON.stringify(c.body).includes(email));assert.ok(!JSON.stringify(c.body).includes(secret));assert.match(c.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict; Max-Age=600/);
});
test('verified owner and browser nonce issue isolated session; prior key sessions no longer work',async()=>{
 const s=setup(),c=await challenge(s),r=response();await s.api(request('POST',{headers:{host:'owner.example',origin:'https://owner.example',cookie:c.headers['Set-Cookie'].split(';')[0]},body:{credential:'signed-token'}}),r);assert.equal(r.code,200);assert.equal(s.checks(),1);
 const cookie=r.headers['Set-Cookie'][0].split(';')[0].split('=')[1];assert.ok(verifySession(cookie,googleSessionSecret(secret,clientId,ownerHash),now));assert.equal(verifySession(issueSession(secret,now),googleSessionSecret(secret,clientId,ownerHash),now),false);
 assert.match(r.headers['Set-Cookie'][1],/Max-Age=0/);
});
test('other users, unverified email, invalid claims, missing sub and nonce cannot sign in',async()=>{
 for(const override of [{email:'stranger@gmail.com'},{email_verified:false},{nonce:'wrong'},{aud:'other'},{iss:'evil'},{exp:Math.floor(now/1000)},{sub:''}]){
 const s=setup(override),c=await challenge(s),r=response();await s.api(request('POST',{headers:{host:'owner.example',origin:'https://owner.example',cookie:c.headers['Set-Cookie'].split(';')[0]},body:{credential:'signed-token'}}),r);assert.equal(r.code,403,JSON.stringify(override));assert.equal(r.headers['Set-Cookie'],undefined);
 }
});
test('CSRF, missing/tampered/expired challenge fail before verifying tokens',async()=>{
 const s=setup(),c=await challenge(s);for(const headers of [{host:'owner.example',origin:'https://evil.example',cookie:c.headers['Set-Cookie'].split(';')[0]},{host:'owner.example',origin:'https://owner.example'},{host:'owner.example',origin:'https://owner.example',cookie:c.headers['Set-Cookie'].split(';')[0]+'x'}]){const r=response();await s.api(request('POST',{headers,body:{credential:'signed-token'}}),r);assert.equal(r.code,403);}
 s.setClock(now+600000);const r=response();await s.api(request('POST',{headers:{host:'owner.example',origin:'https://owner.example',cookie:c.headers['Set-Cookie'].split(';')[0]},body:{credential:'signed-token'}}),r);assert.equal(r.code,403);assert.equal(s.checks(),0);
});
test('Google verification error stays generic; configured Google mode rejects the key login',async()=>{
 const s=setup(),c=await challenge(s);const api=createOwnerGoogleApi({secret,clientId,ownerHash,now:()=>now,verifyIdToken:async()=>{throw Error('private-token-detail');}});const r=response();await api(request('POST',{headers:{host:'owner.example',origin:'https://owner.example',cookie:c.headers['Set-Cookie'].split(';')[0]},body:{credential:'bad-signature'}}),r);assert.equal(r.code,403);assert.equal(JSON.stringify(r.body).includes('private'),false);
 const owner=createOwnerDashboardApi({secret,googleOnly:true,readPackage:()=>{throw Error('must not read');}});const denied=response();await owner({...request('POST',{body:{secret}}),query:{ownerRoute:'dashboard-session'}},denied);assert.equal(denied.code,403);
});

test('Google activation requires a separate server secret; legacy key alone cannot authorize',async()=>{
 const {default:handler}=await import('../api/decision-event.js');
 const names=['VECTOR_OWNER_GOOGLE_CLIENT_ID','VECTOR_OWNER_GOOGLE_SESSION_SECRET','VECTOR_OWNER_DASHBOARD_SECRET'];
 const previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 process.env.VECTOR_OWNER_GOOGLE_CLIENT_ID=clientId;
 process.env.VECTOR_OWNER_DASHBOARD_SECRET=secret;
 delete process.env.VECTOR_OWNER_GOOGLE_SESSION_SECRET;
 try {
  for(const route of ['dashboard-data','dashboard-google']){
   const r=response();await handler({url:'/api/decision-event?ownerRoute='+route,method:'GET',headers:{cookie:'__Host-vector_owner='+issueSession(secret,now)}},r);assert.equal(r.code,503);
  }
 }finally{for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}}
});
