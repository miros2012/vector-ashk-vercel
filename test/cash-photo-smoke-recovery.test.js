import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCashPhotoSmokeHandler } from '../lib/cash-photo-automatic-smoke.js';

const sha = 'c'.repeat(40);
const fixtureHash = 'd583bea9bd7dc9eabe321a6d7d628e15ba9c804806e577ba38a6457cd18d4c88';

function claims() {
  return {
    iss: 'https://token.actions.githubusercontent.com', aud: 'vector-cash-photo-smoke-v1',
    sub: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main',
    repository: 'miros2012/vector-ashk-vercel', repository_id: '1350493825',
    repository_owner_id: '46207692', actor_id: '46207692', ref: 'refs/heads/main',
    workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/test.yml@refs/heads/main',
    event_name: 'push', runner_environment: 'github-hosted', run_id: '9001', run_attempt: '1',
    sha, workflow_sha: sha
  };
}

function responseRecorder() {
  return {
    headers: {}, code: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('production smoke performs one bounded pending-photo recovery after fixture verification', async () => {
  const bytes = Buffer.from(
    await readFile(new URL('../lib/cash-photo-smoke-fixture.base64', import.meta.url), 'utf8'),
    'base64'
  );
  const row = [
    'PHOTO-SMOKE', '2026-09-01T00:00:00.000Z', 'ТЕСТ ЗАГРУЗКИ', '2026',
    'vector-upload-test.png', 'https://drive.google.com/file/d/test/view', fixtureHash,
    'Распознано — ожидает обработки', '0', '0', '', 'gemini-test', 'Synthetic fixture',
    JSON.stringify({ initialBalance: -1, visibleMoneyRowCount: 0, finalBalance: -1, finalBalanceReadable: false, pageNote: 'Synthetic fixture', operations: [] })
  ];
  const recoveryCalls = [];
  let uploadCalls = 0;
  const services = {
    spreadsheetId: 'test-book',
    sheets: { spreadsheets: { values: {
      async get() { return { data: { values: [structuredClone(row)] } }; }
    } } },
    uploadService: {
      async upload() {
        uploadCalls += 1;
        return {
          statusCode: 200,
          body: { ok: true, photoId: 'PHOTO-SMOKE', alreadyStored: true }
        };
      }
    },
    store: {
      async findByHash(value) {
        assert.equal(value, fixtureHash);
        return { photoId: 'PHOTO-SMOKE', fileId: 'test', branch: 'ТЕСТ ЗАГРУЗКИ', year: 2026, fileName: 'vector-upload-test.png' };
      },
      async readPhoto() { return { imageBytes: bytes, mimeType: 'image/png' }; }
    },
    retryService: {
      async retryPendingConcurrent(limit, filters, options) {
        recoveryCalls.push({ limit, filters, options });
        return { attempted: 3, recognized: 2, stillPending: 1, failed: 0 };
      }
    }
  };
  const handler = createCashPhotoSmokeHandler({
    verifyToken: async () => claims(),
    getServices: async () => services,
    deploymentShaProvider: () => sha
  });
  const res = responseRecorder();

  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer opaque-oidc-token' },
    body: { mode: 'cash_photo_smoke' }
  }, res);

  assert.equal(res.code, 200);
  assert.equal(uploadCalls, 2);
  assert.deepEqual(recoveryCalls, [{ limit: 3, filters: {}, options: { reconcileDraft: false } }]);
  assert.deepEqual(res.body.recovery, { attempted: 3, recognized: 2, stillPending: 1, failed: 0 });
});
