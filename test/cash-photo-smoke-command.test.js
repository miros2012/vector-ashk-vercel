import test from 'node:test';
import assert from 'node:assert/strict';
import { runCashPhotoSmoke } from '../scripts/cash-photo-smoke.mjs';
const sha = 'a'.repeat(40);
const env = { GITHUB_SHA: sha, ACTIONS_ID_TOKEN_REQUEST_URL: 'https://run.actions.githubusercontent.com/token?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-secret' };
const good = { ok: true, mode: 'cash_photo_smoke', deploymentSha: sha, checks: { driveReadback: true, archiveReadback: true, duplicatePrevented: true, operations: 0 } };
function fixture(responses) {
  const requests = [], logs = []; let waits = 0;
  return { logs, requests, get waits() { return waits; }, run: () => runCashPhotoSmoke({ env, sleep: async () => { waits++; }, write: value => logs.push(value), fetchImpl: async (url, init) => {
    requests.push({ url, init });
    if (url.startsWith('https://run.actions.githubusercontent.com/')) {
      assert.equal(new URL(url).searchParams.get('audience'), 'vector-cash-photo-smoke-v1');
      return { ok: true, json: async () => ({ value: 'short-lived-jwt' }) };
    }
    assert.equal(url, 'https://vector-ashk-backend.vercel.app/api/health');
    assert.equal(init.headers.authorization, 'Bearer short-lived-jwt');
    assert.deepEqual(JSON.parse(init.body), { mode: 'cash_photo_smoke' });
    const [status, body] = responses.shift() || [409, { error: 'deployment_not_current' }];
    return { status, headers: new Headers({ 'cache-control': 'no-store' }), json: async () => body };
  } }) };
}
test('waits for the new deployment and then accepts matching archive, Drive and duplicate evidence', async () => {
  const f = fixture([[200, { ok: true, service: 'vector-ashk-backend' }], [409, { error: 'deployment_not_current' }], [200, good]]);
  assert.equal((await f.run()).ok, true); assert.equal(f.waits, 2);
  assert.doesNotMatch(JSON.stringify(f.logs), /secret|jwt/);
});
for (const bad of [{ ...good, deploymentSha: 'b'.repeat(40) }, { ...good, checks: { ...good.checks, duplicatePrevented: false } }, { ...good, checks: { ...good.checks, operations: 1 } }]) {
  test('rejects a green-looking response that lacks the required proof', async () => {
    const f = fixture([[200, bad]]); await assert.rejects(f.run(), /smoke_attestation_invalid/);
  });
}
test('permanent denial fails immediately and does not echo server error details', async () => {
  const f = fixture([[403, { error: 'private-secret-dump' }]]);
  await assert.rejects(f.run(), error => error.message === 'cash_photo_smoke_http_403');
  assert.equal(f.waits, 0); assert.doesNotMatch(JSON.stringify(f.logs), /private/);
});
test('recognition retries stop after three pending responses', async () => {
  const pending = [202, { ok: false, error: 'recognition_pending' }];
  const f = fixture([pending, pending, pending]);
  await assert.rejects(f.run(), /cash_photo_recognition_pending/); assert.equal(f.waits, 2);
});
test('deployment wait is bounded', async () => {
  const f = fixture([]); await assert.rejects(f.run(), /cash_photo_deployment_timeout/);
  assert.equal(f.waits, 17);
});

test('successful responses cannot add unreviewed fields to public workflow logs', async () => {
  const f = fixture([[200, { ...good, checks: { ...good.checks, extra: 'private-server-data' } }]]);
  await f.run(); assert.doesNotMatch(JSON.stringify(f.logs), /private-server-data|extra/);
});
