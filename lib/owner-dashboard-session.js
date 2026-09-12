import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export const SESSION_SECONDS = 8 * 60 * 60;
export const COOKIE_NAME = '__Host-vector_owner';
export function validSecret(secret) { return typeof secret === 'string' && secret.length >= 32 && secret.length <= 512; }
export function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length > 512 || !validSecret(b)) return false;
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
function sign(payload, secret) { return createHmac('sha256', secret).update(`vector-owner-session-v1:${payload}`).digest('base64url'); }
export function issueSession(secret, now = Date.now()) {
  if (!validSecret(secret)) throw new Error('dashboard authentication unavailable');
  const payload = Buffer.from(JSON.stringify({v:1,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+SESSION_SECONDS,nonce:randomBytes(16).toString('base64url')})).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}
export function verifySession(token, secret, now = Date.now()) {
  if (!validSecret(secret) || typeof token !== 'string' || token.length > 1024) return false;
  try {
    const parts = token.split('.');
    if(parts.length !== 2) return false;
    const [payload,signature] = parts;
    const expected = Buffer.from(sign(payload, secret)); const actual = Buffer.from(signature);
    if(expected.length !== actual.length || !timingSafeEqual(expected,actual)) return false;
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    const seconds=Math.floor(now/1000);
    return data.v===1 && Number.isInteger(data.iat) && Number.isInteger(data.exp) && data.iat<=seconds && data.exp>seconds && data.exp-data.iat===SESSION_SECONDS;
  } catch { return false; }
}
export function sessionCookie(token, maxAge=SESSION_SECONDS) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function requestSession(req) {
  const cookies=String(req.headers?.cookie || '').split(';').map(x=>x.trim()).filter(x=>x.startsWith(`${COOKIE_NAME}=`));
  return cookies.length===1 ? cookies[0].slice(COOKIE_NAME.length+1) : '';
}
