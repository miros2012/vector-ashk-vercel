import test from 'node:test';
import assert from 'node:assert/strict';
import { createCashPhotoSmokeHandler } from '../lib/cash-photo-automatic-smoke.js';
import { createCashPhotoStore } from '../lib/cash-photo-store.js';
import { createCashPhotoUploadService } from '../lib/cash-photo-upload-service.js';

const sha = 'a'.repeat(40);
const claims = () => ({
  iss: 'https://token.actions.githubusercontent.com', aud: 'vector-cash-photo-smoke-v1',
  sub: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main',
  repository: 'miros2012/vector-ashk-vercel', repository_id: '1350493825',
  repository_owner_id: '46207692', actor_id: '46207692', ref: 'refs/heads/main',
  workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/test.yml@refs/heads/main',
  event_name: 'push', runner_environment: 'github-hosted', run_id: '123', run_attempt: '1',
  sha, workflow_sha: sha
});
function setup({ patch = {}, invalidSignature = false, pending = false, corrupt = false } = {}) {
  const rows = [], files = new Map(), writes = [];
  let serviceCalls = 0, recognizes = 0;
  const sheets = { spreadsheets: { values: {
    async get(args) {
      assert.equal(args.range, "'Архив кассовых фото'!A2:N");
      return { data: { values: structuredClone(rows) } };
    },
    async append(args) {
      writes.push(args.range); rows.push([...args.requestBody.values[0]]);
      return { data: { updates: { updatedRange: "'Архив кассовых фото'!A2:N2" } } };
    },
    async update(args) {
      writes.push(args.range);
      const offset = args.range.match(/!([A-Z])/)[1].charCodeAt(0) - 65;
      args.requestBody.values[0].forEach((value, i) => rows[0][offset + i] = value);
      if (corrupt && offset === 7 && rows[0][13]) rows[0][13] = '{broken';
      return { data: {} };
    }
  } } };
  const drive = { files: {
    async create(args) {
      assert.deepEqual(args.requestBody.parents, ['test-folder']);
      const chunks = []; for await (const chunk of args.media.body) chunks.push(chunk);
      files.set('test-file', Buffer.concat(chunks));
      return { data: { id: 'test-file', webViewLink: 'https://drive.google.com/file/d/test-file/view' } };
    },
    async get({ fileId }) {
      return { data: files.get(fileId), headers: { 'content-type': 'image/png' } };
    }
  } };
  const store = createCashPhotoStore({ drive, sheets, spreadsheetId: 'test-book', folderId: 'test-folder' });
  const uploadService = createCashPhotoUploadService({ store, recognize: async input => {
    recognizes++;
    assert.equal(files.size, 1); assert.equal(rows.length, 1);
    assert.equal(input.branch, 'ТЕСТ ЗАГРУЗКИ'); assert.equal(input.fileName, 'vector-upload-test.png');
    if (pending) throw Object.assign(new Error('private provider error'), { retryable: true });
    return { model: 'gemini-test', data: { operations: [], pageNote: 'Synthetic fixture' } };
  } });
  const handler = createCashPhotoSmokeHandler({
    verifyToken: async (token, options) => {
      assert.equal(token, 'opaque-oidc-token'); assert.equal(options.audience, 'vector-cash-photo-smoke-v1');
      if (invalidSignature) throw new Error('private JWT details');
      return { ...claims(), ...patch };
    },
    deploymentShaProvider: () => sha,
    getServices: async () => { serviceCalls++; return { store, uploadService, sheets, spreadsheetId: 'test-book' }; }
  });
  async function run(body = { mode: 'cash_photo_smoke' }, method = 'POST', authorization = 'Bearer opaque-oidc-token') {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method, headers: { authorization }, body }, res); return res;
  }
  return { run, rows, files, writes, stats: () => ({ serviceCalls, recognizes }) };
}

for (const [field, value] of Object.entries({
  iss: 'https://attacker.invalid', aud: 'vector-owner-package-smoke-v1', sub: 'wrong-subject',
  repository: 'other/repo', repository_id: '1', repository_owner_id: '1', actor_id: '1',
  ref: 'refs/heads/feature', workflow_ref: 'other.yml', event_name: 'pull_request',
  runner_environment: 'self-hosted', run_id: '', run_attempt: '0', workflow_sha: 'b'.repeat(40)
})) test(`rejects untrusted ${field} before obtaining storage services`, async () => {
  const f = setup({ patch: { [field]: value } }); const res = await f.run();
  assert.equal(res.code, 403); assert.equal(f.stats().serviceCalls, 0);
});

test('invalid or missing bearer cannot reach Drive, and errors do not disclose credentials', async () => {
  const f = setup({ invalidSignature: true });
  for (const token of ['Bearer opaque-oidc-token', '']) {
    const res = await f.run(undefined, 'POST', token);
    assert.equal(res.code, 403); assert.doesNotMatch(JSON.stringify(res.body), /private|opaque/);
  }
  assert.equal(f.stats().serviceCalls, 0);
});

test('an earlier deployment rejects a trusted newer commit without writes', async () => {
  const f = setup({ patch: { sha: 'b'.repeat(40), workflow_sha: 'b'.repeat(40) } });
  assert.equal((await f.run()).code, 409); assert.equal(f.stats().serviceCalls, 0);
});

test('only the fixed POST operation is accepted; callers cannot select files, branches or photos', async () => {
  const f = setup();
  assert.equal((await f.run(undefined, 'GET')).code, 405);
  for (const body of [{ mode: 'cash_photo_smoke', branch: 'Ямская' }, { mode: 'cash_photo_smoke', image: 'custom' }, { mode: 'other' }]) {
    assert.equal((await f.run(body)).code, 400);
  }
  assert.equal(f.stats().serviceCalls, 0);
});

test('fixed PNG is saved, recognized and independently read back; repeat creates no file, row or AI request', async () => {
  const f = setup(); const first = await f.run(); const again = await f.run();
  assert.equal(first.code, 200); assert.equal(again.code, 200);
  assert.equal(first.headers['Cache-Control'], 'no-store');
  assert.deepEqual(first.body.checks, { driveReadback: true, archiveReadback: true, duplicatePrevented: true, operations: 0 });
  assert.equal(first.body.deploymentSha, sha); assert.equal(first.body.newUpload, true);
  assert.equal(again.body.newUpload, false);
  assert.equal(f.files.size, 1); assert.equal(f.rows.length, 1); assert.equal(f.stats().recognizes, 1);
  assert.equal(f.rows[0][7], 'Распознано — ожидает обработки'); assert.equal(f.rows[0][10], '');
  assert.ok(f.writes.every(range => range.startsWith("'Архив кассовых фото'!")));
});

test('pending recognition is reported as pending, never a green upload smoke', async () => {
  const f = setup({ pending: true }); const res = await f.run();
  assert.equal(res.code, 202); assert.equal(res.body.ok, false);
  assert.equal(f.rows[0][7], 'Ожидает распознавания'); assert.equal(f.files.size, 1);
});

test('HTTP upload success with corrupted archive JSON is not accepted as proof', async () => {
  const f = setup({ corrupt: true }); const res = await f.run();
  assert.equal(res.code, 500); assert.equal(res.body.ok, false);
  assert.doesNotMatch(JSON.stringify(res.body), /broken|stack|private/);
});
