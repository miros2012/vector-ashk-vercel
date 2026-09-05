import { createPublicKey, verify as verifySignature } from 'node:crypto';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const AUDIENCE = 'vector-hourly-agent-v1';
const MAX_TOKEN_AGE_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 30;

function requiredText(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function decodeJson(segment, name) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new Error(`invalid ${name}`);
  }
}

function audienceMatches(actual, expected) {
  if (Array.isArray(actual)) return actual.map(String).includes(expected);
  return String(actual || '') === expected;
}

function numericClaim(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} claim is invalid`);
  return number;
}

function assertTemporalClaims(payload, nowMs) {
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  const exp = numericClaim(payload.exp, 'exp');
  const nbf = numericClaim(payload.nbf, 'nbf');
  const iat = numericClaim(payload.iat, 'iat');

  if (exp < nowSeconds - CLOCK_SKEW_SECONDS) throw new Error('token expired');
  if (nbf > nowSeconds + CLOCK_SKEW_SECONDS) throw new Error('token is not active');
  if (iat > nowSeconds + CLOCK_SKEW_SECONDS) throw new Error('token issued in the future');
  if (nowSeconds - iat > MAX_TOKEN_AGE_SECONDS + CLOCK_SKEW_SECONDS) {
    throw new Error('token is too old');
  }
}

async function loadSigningKey({ kid, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(JWKS_URL, {
      method: 'GET',
      headers: { accept: 'application/json' }
    });
  } catch {
    throw new Error('GitHub Actions key set unavailable');
  }
  if (!response?.ok) throw new Error('GitHub Actions key set unavailable');

  let document;
  try {
    document = await response.json();
  } catch {
    throw new Error('GitHub Actions key set invalid');
  }
  const key = Array.isArray(document?.keys)
    ? document.keys.find((candidate) => String(candidate?.kid || '') === kid)
    : null;
  if (!key) throw new Error('GitHub Actions signing key not found');
  return key;
}

export async function verifyGitHubActionsOidcToken(token, {
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  audience = AUDIENCE
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const raw = requiredText(token, 'token');
  const segments = raw.split('.');
  if (segments.length !== 3) throw new Error('invalid token');

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = decodeJson(encodedHeader, 'token header');
  const payload = decodeJson(encodedPayload, 'token payload');

  if (header.alg !== 'RS256') throw new Error('unsupported token signature algorithm');
  const kid = requiredText(header.kid, 'signing key id');
  const jwk = await loadSigningKey({ kid, fetchImpl });

  let publicKey;
  try {
    publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    throw new Error('GitHub Actions signing key invalid');
  }

  const signatureOk = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    publicKey,
    Buffer.from(encodedSignature, 'base64url')
  );
  if (!signatureOk) throw new Error('token signature verification failed');

  if (payload.iss !== ISSUER) throw new Error('token issuer is invalid');
  if (!audienceMatches(payload.aud, audience)) throw new Error('token audience is invalid');
  assertTemporalClaims(payload, typeof now === 'function' ? now() : now);

  for (const claim of [
    'sub',
    'repository',
    'repository_id',
    'repository_owner_id',
    'ref',
    'workflow_ref',
    'event_name',
    'actor_id',
    'run_id',
    'run_attempt',
    'jti'
  ]) {
    requiredText(payload[claim], claim);
  }

  return payload;
}
