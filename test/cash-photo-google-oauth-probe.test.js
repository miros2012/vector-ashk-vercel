import test from 'node:test';
import assert from 'node:assert/strict';
import { createCashPhotoGoogleOauthProbe } from '../lib/cash-photo-google-oauth-probe.js';

test('Gemini OAuth probe uses the service account token without exposing it', async () => {
  const calls = [];
  const probe = createCashPhotoGoogleOauthProbe({
    projectId: 'vector-finance-ai',
    authorize: async () => ({ access_token: 'secret-token' }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    }
  });

  assert.deepEqual(await probe(), { ok: true, status: 200 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1/models');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[0].options.headers['x-goog-user-project'], 'vector-finance-ai');
  assert.equal(JSON.stringify(await probe()).includes('secret-token'), false);
});

test('Gemini OAuth probe returns only a safe upstream status on rejection', async () => {
  const probe = createCashPhotoGoogleOauthProbe({
    projectId: 'vector-finance-ai',
    authorize: async () => ({ access_token: 'secret-token' }),
    fetchImpl: async () => ({ ok: false, status: 403 })
  });
  assert.deepEqual(await probe(), { ok: false, status: 403 });
});

test('Gemini OAuth probe fails closed when no service-account token exists', async () => {
  const probe = createCashPhotoGoogleOauthProbe({
    projectId: 'vector-finance-ai',
    authorize: async () => ({}),
    fetchImpl: async () => { throw new Error('must not fetch'); }
  });
  await assert.rejects(() => probe(), /access token/i);
});
