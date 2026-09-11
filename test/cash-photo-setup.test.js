import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCashPhotoConsent, provisionCashPhotoFolder, saveCashPhotoSecrets, buildCashPhotoAccess } from '../lib/cash-photo-setup.js';
import { createCashPhotoAccessStore } from '../lib/cash-photo-access-store.js';

test('consent requires CSRF state, uses PKCE and sends its code only to the OAuth client', async () => {
  let authorize, exchanged;
  const auth = {
    generateAuthUrl(args) { authorize = args; return 'https://accounts.google.com/o/oauth2/v2/auth'; },
    async getToken(args) { exchanged = args; return { tokens: { refresh_token: 'test-refresh', scope: 'https://www.googleapis.com/auth/drive.file' } }; }
  };
  const flow = await startCashPhotoConsent({ auth, timeoutMs: 3000 });
  try {
    assert.equal(authorize.scope, 'https://www.googleapis.com/auth/drive.file');
    assert.equal(authorize.access_type, 'offline');
    assert.equal(authorize.code_challenge_method, 'S256');
    assert.match(flow.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.equal((await fetch(flow.redirectUri + '?state=wrong&code=stolen')).status, 400);
    assert.equal(exchanged, undefined);
    const callback = new URL(flow.redirectUri);
    callback.searchParams.set('state', authorize.state);
    callback.searchParams.set('code', 'one-use-code');
    const response = await fetch(callback);
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /test-refresh|one-use-code/);
    assert.equal((await flow.result).refresh_token, 'test-refresh');
    assert.equal(exchanged.code, 'one-use-code');
    assert.equal(exchanged.redirect_uri, flow.redirectUri);
    assert.ok(exchanged.codeVerifier.length >= 43);
  } finally { await flow.close(); }
});

test('denied OAuth consent returns a safe error and completes without waiting for timeout', async () => {
  let authorize;
  const flow = await startCashPhotoConsent({ auth: { generateAuthUrl(args) { authorize = args; return 'https://accounts.google.com/'; } }, timeoutMs: 3000 });
  const rejected = assert.rejects(flow.result, /Google consent was not granted/);
  try {
    const url = new URL(flow.redirectUri);
    url.searchParams.set('state', authorize.state);
    url.searchParams.set('error', 'raw-error-secret');
    assert.equal((await fetch(url)).status, 400);
    await rejected;
  } finally { await flow.close(); }
});

test('folder provisioning uses app-owned marker and grants only reader access to backend', async () => {
  const calls = [];
  const drive = { files: { async list(args) { calls.push(['list', args]); return { data: { files: [] } }; }, async create(args) { calls.push(['create', args]); return { data: { id: 'new-folder' } }; } }, permissions: { async create(args) { calls.push(['permission', args]); } } };
  assert.equal(await provisionCashPhotoFolder({ drive, serviceAccountEmail: 'backend@test.iam.gserviceaccount.com' }), 'new-folder');
  assert.match(calls[0][1].q, /appProperties/);
  assert.equal(calls[1][1].requestBody.mimeType, 'application/vnd.google-apps.folder');
  assert.equal(calls[2][1].requestBody.role, 'reader');
  assert.equal(calls[2][1].sendNotificationEmail, false);
});

test('setup emits private files, hashes authorize correctly and existing files are not overwritten', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cash-photo-setup-'));
  try {
    const { registry, links } = buildCashPhotoAccess([{ accessId: 'BRANCH:Y', branch: 'Ямская', label: 'Ямская' }]);
    const token = new URL(links[0].url).hash.slice('#token='.length);
    assert.equal((await createCashPhotoAccessStore({ registryJson: JSON.stringify(registry) }).authorize(token)).branch, 'Ямская');
    assert.doesNotMatch(JSON.stringify(registry), new RegExp(token));
    const dir = join(temp, 'private');
    await saveCashPhotoSecrets({ directory: dir, env: { TEST_SECRET: 'do-not-print' }, links });
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal((await stat(join(dir, 'vercel.env'))).mode & 0o777, 0o600);
    assert.match(await readFile(join(dir, 'vercel.env'), 'utf8'), /TEST_SECRET='do-not-print'/);
    await assert.rejects(saveCashPhotoSecrets({ directory: dir, env: { TEST_SECRET: 'replacement' }, links }));
    assert.doesNotMatch(await readFile(join(dir, 'vercel.env'), 'utf8'), /replacement/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
