import test from 'node:test';
import assert from 'node:assert/strict';
import { google as actualGoogle } from 'googleapis';
import { createCashPhotoDriveWriter } from '../lib/cash-photo-drive-writer.js';

const env = { CASH_PHOTO_DRIVE_CLIENT_ID: 'client', CASH_PHOTO_DRIVE_CLIENT_SECRET: 'secret', CASH_PHOTO_DRIVE_REFRESH_TOKEN: 'refresh' };
function fixture({ failure, folder = { id: 'folder', mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, capabilities: { canAddChildren: true } } } = {}) {
  const calls = [];
  const google = { auth: { OAuth2: class { constructor(...args) { calls.push(['oauth', args]); } setCredentials(value) { calls.push(['credentials', value]); } } }, drive(args) { calls.push(['drive', args]); return { files: { async create(args, options) { calls.push(['create', args, options]); if (failure) throw failure; return { data: { id: 'new-file' } }; }, async get(args, options) { calls.push(['get', args, options]); if (failure) throw failure; return { data: folder }; } } }; } };
  return { google, calls };
}

test('missing or partial OAuth configuration never falls back to service-account writes', async () => {
  for (const input of [{}, { CASH_PHOTO_DRIVE_CLIENT_ID: 'client' }]) {
    const { google, calls } = fixture();
    const writer = createCashPhotoDriveWriter({ google, env: input });
    assert.equal(writer.configured, false);
    assert.equal((await writer.probe('folder')).ok, false);
    await assert.rejects(writer.files.create({}), /Cash photo Drive is not configured/);
    assert.deepEqual(calls, []);
  }
});

test('uploads use the user OAuth refresh token and bounded Drive request', async () => {
  const { google, calls } = fixture();
  const writer = createCashPhotoDriveWriter({ google, env });
  const result = await writer.files.create({ requestBody: { name: 'photo' } });
  assert.equal(result.data.id, 'new-file');
  assert.deepEqual(calls[0], ['oauth', [{ clientId: 'client', clientSecret: 'secret', transporterOptions: { timeout: 10000, retry: false, retryConfig: { retry: 0 } } }]]);
  assert.deepEqual(calls[1], ['credentials', { refresh_token: 'refresh' }]);
  assert.equal(calls.at(-1)[2].timeout, 15000);
  assert.equal((await writer.probe('folder')).ok, true);
});

test('probe rejects non-folders, non-owned folders, denied writes and credential errors safely', async () => {
  for (const input of [{ folder: { id: 'folder', ownedByMe: true, mimeType: 'image/png', capabilities: { canAddChildren: true } } }, { folder: { id: 'folder', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } } }, { failure: new Error('refresh secret raw-provider-body') }]) {
    const writer = createCashPhotoDriveWriter({ google: fixture(input).google, env });
    const result = await writer.probe('folder');
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /refresh|secret|raw-provider-body/);
  }
});

test('write errors discard upstream credentials before reaching callers', async () => {
  const writer = createCashPhotoDriveWriter({ google: fixture({ failure: new Error('secret refresh body') }).google, env });
  await assert.rejects(writer.files.create({}), error => error.message === 'Cash photo Drive upload failed' && error.cause === undefined);
});

test('real Google SDK cannot silently retry refresh tokens beyond the request budget', async () => {
  const calls = [];
  const google = {
    auth: { OAuth2: class extends actualGoogle.auth.OAuth2 {
      constructor(options) {
        super(options);
        this.transporter.defaults.retryConfig = { ...this.transporter.defaults.retryConfig, retryBackoff: async () => {} };
        this.transporter.defaults.adapter = async options => {
          calls.push(new URL(options.url).host);
          return Object.assign(new Response('{}', { status: 503 }), { data: {}, config: options });
        };
      }
    } },
    drive: actualGoogle.drive.bind(actualGoogle)
  };
  const writer = createCashPhotoDriveWriter({ google, env });
  await assert.rejects(writer.files.create({ requestBody: { name: 'test' } }), /Cash photo Drive upload failed/);
  assert.deepEqual(calls, ['oauth2.googleapis.com']);
  calls.length = 0;
  assert.deepEqual(await writer.probe('folder'), { ok: false, configured: true, reason: 'upload_folder_unavailable' });
  assert.deepEqual(calls, ['oauth2.googleapis.com']);
});
