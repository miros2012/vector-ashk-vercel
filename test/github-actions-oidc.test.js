import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyGitHubActionsOidcToken } from '../lib/github-actions-oidc.js';

const nowSeconds = 1_800_000_000;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };

const baseClaims = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'vector-hourly-agent-v1',
  sub: 'repo:miros2012/vector-ashk-vercel:ref:refs/heads/main',
  repository: 'miros2012/vector-ashk-vercel',
  repository_id: '1350493825',
  repository_owner_id: '46207692',
  ref: 'refs/heads/main',
  workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/hourly-project-continuation.yml@refs/heads/main',
  event_name: 'schedule',
  actor_id: '46207692',
  iat: nowSeconds - 5,
  nbf: nowSeconds - 5,
  exp: nowSeconds + 300,
  jti: 'one'
};

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(claims = baseClaims, signingKey = privateKey) {
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'test-key' });
  const payload = encode(claims);
  const input = `${header}.${payload}`;
  const signature = sign('RSA-SHA256', Buffer.from(input), signingKey).toString('base64url');
  return `${input}.${signature}`;
}

const fetchJwks = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });

test('verifies signature, issuer, audience, time and repository-bound claims', async () => {
  const claims = await verifyGitHubActionsOidcToken(token(), {
    fetchImpl: fetchJwks,
    now: () => nowSeconds * 1000
  });
  assert.equal(claims.repository, 'miros2012/vector-ashk-vercel');
});

test('rejects a token signed by an untrusted key', async () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await assert.rejects(
    verifyGitHubActionsOidcToken(token(baseClaims, other.privateKey), { fetchImpl: fetchJwks, now: () => nowSeconds * 1000 }),
    /signature/i
  );
});

test('rejects expired and future tokens', async () => {
  await assert.rejects(
    verifyGitHubActionsOidcToken(token({ ...baseClaims, exp: nowSeconds - 120 }), { fetchImpl: fetchJwks, now: () => nowSeconds * 1000 }),
    /expired/i
  );
  await assert.rejects(
    verifyGitHubActionsOidcToken(token({ ...baseClaims, nbf: nowSeconds + 120 }), { fetchImpl: fetchJwks, now: () => nowSeconds * 1000 }),
    /active/i
  );
});

test('rejects a wrong audience before authorizing the workflow', async () => {
  await assert.rejects(
    verifyGitHubActionsOidcToken(token({ ...baseClaims, aud: 'other-service' }), { fetchImpl: fetchJwks, now: () => nowSeconds * 1000 }),
    /audience/i
  );
});

test('fails closed when the JWKS endpoint is unavailable or the key is absent', async () => {
  await assert.rejects(
    verifyGitHubActionsOidcToken(token(), { fetchImpl: async () => ({ ok: false, status: 503 }), now: () => nowSeconds * 1000 }),
    /key set/i
  );
  await assert.rejects(
    verifyGitHubActionsOidcToken(token(), { fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [] }) }), now: () => nowSeconds * 1000 }),
    /signing key/i
  );
});
