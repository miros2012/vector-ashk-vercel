import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { validSecret, issueSession, sessionCookie } from './owner-dashboard-session.js';
const CHALLENGE_COOKIE = '__Host-vector_google';
const CHALLENGE_SECONDS = 600;
const hash = value => createHash('sha256').update(value).digest('hex');
const sign = (secret, value) => createHmac('sha256', secret).update(value).digest('base64url');
function equal(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left=Buffer.from(a), right=Buffer.from(b);
  return left.length===right.length && timingSafeEqual(left,right);
}
function normalizedGoogleEmail(email) {
  if (typeof email!=='string') return '';
  const [local,domain,...extra]=email.toLowerCase().trim().split('@');
  if(extra.length || !local || domain!=='gmail.com') return '';
  return local.replaceAll('.','')+'@gmail.com';
}
export function googleSessionSecret(secret, clientId, ownerHash) {
  if (!clientId) return secret;
  if (!validSecret(secret)) return '';
  return createHmac('sha256',secret).update(`owner-google-v1:${clientId}:${ownerHash}`).digest('hex');
}
function challengeCookie(value,maxAge=CHALLENGE_SECONDS) {
  return `${CHALLENGE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function readChallenge(req, secret, now) {
  const values=String(req.headers?.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(CHALLENGE_COOKIE+'='));
  if(values.length!==1)return null;
  const token=values[0].slice(CHALLENGE_COOKIE.length+1);
  if(token.length>1024)return null;
  const parts=token.split('.');
  if(parts.length!==2 || !equal(parts[1],sign(secret,'challenge:'+parts[0])))return null;
  try {
    const data=JSON.parse(Buffer.from(parts[0],'base64url').toString());
    const seconds=Math.floor(now/1000);
    return typeof data.nonce==='string' && /^[A-Za-z0-9_-]{43}$/.test(data.nonce) && Number.isInteger(data.exp) && data.exp>seconds && data.exp<=seconds+CHALLENGE_SECONDS ? data : null;
  } catch {return null;}
}
export function createOwnerGoogleApi({secret,clientId,ownerHash,verifyIdToken,now=Date.now}) {
  const sessionSecret=googleSessionSecret(secret,clientId,ownerHash);
  return async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    if(req.method==='GET' && !clientId)return res.status(200).json({enabled:false});
    if(!validSecret(secret) || !/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId||'') || !/^[a-f0-9]{64}$/.test(ownerHash||''))return res.status(503).json({ok:false,error:'google_auth_unavailable'});
    if(req.headers?.['sec-fetch-site']==='cross-site')return res.status(403).json({ok:false,error:'forbidden'});
    if(req.method==='GET') {
      const nonce=randomBytes(32).toString('base64url');
      const payload=Buffer.from(JSON.stringify({nonce,exp:Math.floor(now()/1000)+CHALLENGE_SECONDS})).toString('base64url');
      res.setHeader('Set-Cookie',challengeCookie(payload+'.'+sign(sessionSecret,'challenge:'+payload)));
      return res.status(200).json({enabled:true,clientId,nonce});
    }
    if(typeof req.headers?.host!=='string' || req.headers?.origin!==`https://${req.headers.host}`)return res.status(403).json({ok:false,error:'forbidden'});
    const challenge=readChallenge(req,sessionSecret,now());
    if(!challenge)return res.status(403).json({ok:false,error:'forbidden'});
    let body=req.body;
    if(typeof body==='string'){if(body.length>20000)return res.status(400).json({ok:false,error:'invalid_request'});try{body=JSON.parse(body);}catch{return res.status(400).json({ok:false,error:'invalid_request'});}}
    if(typeof body?.credential!=='string' || body.credential.length>16000 || !body.credential)return res.status(400).json({ok:false,error:'invalid_request'});
    try {
      const identity=await verifyIdToken(body.credential,clientId);
      const email=normalizedGoogleEmail(identity?.email);
      if(!email || identity.email_verified!==true || !equal(hash(email),ownerHash) || identity.aud!==clientId || !['https://accounts.google.com','accounts.google.com'].includes(identity.iss) || typeof identity.sub!=='string' || !identity.sub || !Number.isFinite(identity.exp) || identity.exp<=Math.floor(now()/1000) || !equal(identity.nonce,challenge.nonce))return res.status(403).json({ok:false,error:'forbidden'});
      res.setHeader('Set-Cookie',[sessionCookie(issueSession(sessionSecret,now())),challengeCookie('',0)]);
      return res.status(200).json({ok:true});
    } catch {return res.status(403).json({ok:false,error:'google_sign_in_failed'});}
  };
}
