import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { exportAshkPaymentArchive } from '../scripts/export-ashk-payment-archive.mjs';
import { decryptPaymentArchive } from '../lib/payment-archive-encryption.js';

test('archive exporter uses OIDC, writes the full private artifact and logs summary only', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const calls = [];
  const writes = [];
  const logs = [];
  const archive = {
    ok: true,
    mode: 'read_only_payment_archive',
    period: { startDate: '2026-09-01', endDate: '2026-09-30', dayCount: 30 },
    summary: { rows: 1, positive: 5000, refunds: 0, net: 5000 },
    sha256: 'a'.repeat(64),
    payments: [{ Id: 'private-payment-id', PayDate: '2026-09-01T08:00:00', Debit: 5000 }]
  };
  const result = await exportAshkPaymentArchive({
    env: {
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid/token?job=archive',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-secret',
      PAYMENT_ARCHIVE_ENDPOINT: 'https://backend.invalid/api/master-hours-diagnostic',
      ARCHIVE_START_DATE: '2026-09-01',
      ARCHIVE_END_DATE: '2026-09-30',
      ARCHIVE_OUTPUT_PATH: '/tmp/september.enc.json',
      ARCHIVE_PUBLIC_KEY_PATH: '/repo/config/archive-public-key.pem'
    },
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) return {
        ok: true,
        status: 200,
        async json() { return { value: 'signed-oidc' }; }
      };
      return {
        ok: true,
        status: 200,
        async json() { return archive; }
      };
    },
    readFile: async (path, encoding) => {
      assert.equal(path, '/repo/config/archive-public-key.pem');
      assert.equal(encoding, 'utf8');
      return publicKey;
    },
    writeFile: async (path, content, encoding) => writes.push({ path, content, encoding }),
    logger: { log(value) { logs.push(String(value)); } }
  });

  assert.match(calls[0].url, /audience=vector-finance-sync-v1/);
  assert.equal(calls[0].options.headers.authorization, 'Bearer request-secret');
  assert.equal(calls[1].options.headers.authorization, 'Bearer signed-oidc');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    mode: 'payment_archive',
    startDate: '2026-09-01',
    endDate: '2026-09-30'
  });
  const envelope = JSON.parse(writes[0].content);
  assert.equal(writes[0].path, '/tmp/september.enc.json');
  assert.equal(writes[0].encoding, 'utf8');
  assert.equal(writes[0].content.includes('private-payment-id'), false);
  assert.deepEqual(decryptPaymentArchive(envelope, { privateKey }), archive);
  assert.equal(logs.join('\n').includes('private-payment-id'), false);
  assert.match(logs.join('\n'), /"rows":1/);
  assert.deepEqual(result, {
    outputPath: '/tmp/september.enc.json',
    summary: archive.summary,
    sha256: archive.sha256
  });
});

test('archive exporter refuses a non-archive response without writing it', async () => {
  let writes = 0;
  await assert.rejects(
    exportAshkPaymentArchive({
      env: {
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid/token',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-secret',
        PAYMENT_ARCHIVE_ENDPOINT: 'https://backend.invalid/archive',
        ARCHIVE_START_DATE: '2026-09-01',
        ARCHIVE_END_DATE: '2026-09-30',
        ARCHIVE_OUTPUT_PATH: '/tmp/september.enc.json',
        ARCHIVE_PUBLIC_KEY_PATH: '/repo/config/archive-public-key.pem'
      },
      fetchFn: async url => String(url).startsWith('https://oidc.invalid')
        ? { ok: true, status: 200, async json() { return { value: 'signed-oidc' }; } }
        : { ok: false, status: 502, async json() { return { ok: false, error: 'source unavailable' }; } },
      readFile: async () => 'unused',
      writeFile: async () => { writes += 1; },
      logger: { log() {} }
    }),
    /payment archive request failed: 502/
  );
  assert.equal(writes, 0);
});
