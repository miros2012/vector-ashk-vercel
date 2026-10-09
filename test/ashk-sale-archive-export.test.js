import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { exportAshkSaleArchive } from '../scripts/export-ashk-sale-archive.mjs';
import { decryptPaymentArchive } from '../lib/payment-archive-encryption.js';
import {
  createAshkSaleArchiveEvidence,
  validateAshkSaleArchivePeriod
} from '../lib/ashk-sale-archive.js';

test('sale archive exporter verifies evidence and uploads ciphertext only', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const evidence = createAshkSaleArchiveEvidence({
    period: validateAshkSaleArchivePeriod({ startDate: '2026-09-01', endDate: '2026-09-30' }),
    sourceRows: 1,
    sales: [{
      Id: 'private-sale-id', Date: '2026-09-01T08:00:00', EmployeeName: 'Менеджер',
      StudentOwnerName: 'Курсант', StudentId: 1, ProductName: 'Курс', Sum: 5000, Paid: 3000
    }]
  });
  const archive = { ok: true, mode: 'read_only_sale_archive', ...evidence };
  const writes = [];
  const calls = [];
  const logs = [];
  await exportAshkSaleArchive({
    env: {
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid/token',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-secret',
      SALE_ARCHIVE_ENDPOINT: 'https://backend.invalid/archive',
      ARCHIVE_START_DATE: '2026-09-01', ARCHIVE_END_DATE: '2026-09-30',
      ARCHIVE_OUTPUT_PATH: '/tmp/sales.enc.json',
      ARCHIVE_PUBLIC_KEY_PATH: '/repo/config/archive-public-key.pem'
    },
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      return calls.length === 1
        ? { ok: true, status: 200, async json() { return { value: 'signed-oidc' }; } }
        : { ok: true, status: 200, async json() { return archive; } };
    },
    readFile: async () => publicKey,
    writeFile: async (path, content) => writes.push({ path, content }),
    logger: { log(value) { logs.push(String(value)); } }
  });

  assert.deepEqual(JSON.parse(calls[1].options.body), {
    mode: 'sale_archive', startDate: '2026-09-01', endDate: '2026-09-30'
  });
  assert.equal(writes[0].content.includes('private-sale-id'), false);
  assert.deepEqual(decryptPaymentArchive(JSON.parse(writes[0].content), { privateKey }), archive);
  assert.equal(logs.join('\n').includes('private-sale-id'), false);
  assert.match(logs.join('\n'), /"rows":1/);
});

test('sale archive exporter refuses altered evidence before encryption', async () => {
  const evidence = createAshkSaleArchiveEvidence({
    period: validateAshkSaleArchivePeriod({ startDate: '2026-09-01', endDate: '2026-09-30' }),
    sourceRows: 1,
    sales: [{ Id: 's', Date: '2026-09-01', EmployeeName: '', StudentOwnerName: '', StudentId: 1, ProductName: '', Sum: 1, Paid: 1 }]
  });
  let writes = 0;
  await assert.rejects(exportAshkSaleArchive({
    env: {
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'secret',
      SALE_ARCHIVE_ENDPOINT: 'https://backend.invalid/archive', ARCHIVE_START_DATE: '2026-09-01',
      ARCHIVE_END_DATE: '2026-09-30', ARCHIVE_OUTPUT_PATH: '/tmp/sales.enc.json',
      ARCHIVE_PUBLIC_KEY_PATH: '/repo/public.pem'
    },
    fetchFn: async url => String(url).startsWith('https://oidc.invalid')
      ? { ok: true, status: 200, async json() { return { value: 'oidc' }; } }
      : { ok: true, status: 200, async json() { return { ok: true, mode: 'read_only_sale_archive', ...evidence, sha256: 'b'.repeat(64) }; } },
    readFile: async () => 'unused',
    writeFile: async () => { writes += 1; },
    logger: { log() {} }
  }), /sale archive evidence mismatch/);
  assert.equal(writes, 0);
});
