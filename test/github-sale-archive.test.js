import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeSaleArchiveClaims,
  createGitHubSaleArchiveHandler,
  saleArchiveFailureCode
} from '../lib/github-sale-archive.js';

const CLAIMS = Object.freeze({
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'vector-finance-sync-v1',
  sub: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main',
  repository: 'miros2012/vector-ashk-vercel',
  repository_id: '1350493825',
  repository_owner_id: '46207692',
  ref: 'refs/heads/main',
  workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/ashk-sale-archive.yml@refs/heads/main',
  event_name: 'workflow_dispatch',
  actor_id: '46207692',
  run_id: '456',
  run_attempt: '1'
});

function responseRecorder() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = Number(code); return this; },
    json(body) { this.body = body; return this; }
  };
}

test('sale archive accepts only the owner-dispatched sale archive workflow on main', () => {
  assert.deepEqual(authorizeSaleArchiveClaims(CLAIMS), { eventName: 'workflow_dispatch' });
  assert.throws(
    () => authorizeSaleArchiveClaims({ ...CLAIMS, workflow_ref: CLAIMS.workflow_ref.replace('sale', 'payment') }),
    /forbidden sale archive claims/
  );
  assert.throws(() => authorizeSaleArchiveClaims({ ...CLAIMS, run_attempt: '2' }), /forbidden sale archive claims/);
});

test('sale archive handler authenticates before creating an ASHK session and returns source facts only', async () => {
  const calls = [];
  const handler = createGitHubSaleArchiveHandler({
    verifyToken: async () => CLAIMS,
    login: 'private-login',
    password: 'private-password',
    createSession: input => { calls.push(['session', input]); return { requestJson() {} }; },
    buildArchive: async input => {
      calls.push(['archive', input]);
      return {
        period: { startDate: input.startDate, endDate: input.endDate, dayCount: 30 },
        summary: { sourceRows: 1, rows: 1, sum: 5000, paid: 3000, unpaid: 2000 },
        sha256: 'a'.repeat(64),
        sales: [{ Id: 'sale-1', Date: '2026-09-01T08:00:00', Sum: 5000, Paid: 3000 }]
      };
    }
  });
  const res = responseRecorder();
  await handler({
    method: 'POST', headers: { authorization: 'Bearer oidc' },
    body: { mode: 'sale_archive', startDate: '2026-09-01', endDate: '2026-09-30' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'read_only_sale_archive');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(JSON.stringify(res.body).includes('private-login'), false);
  assert.equal(calls[0][0], 'session');
  assert.equal(calls[1][0], 'archive');
});

test('invalid sale archive identity cannot reach ASHK credentials', async () => {
  let sessions = 0;
  const handler = createGitHubSaleArchiveHandler({
    verifyToken: async () => ({ ...CLAIMS, actor_id: '1' }),
    login: 'private-login', password: 'private-password',
    createSession: () => { sessions += 1; return {}; }
  });
  const res = responseRecorder();
  await handler({
    method: 'POST', headers: { authorization: 'Bearer oidc' },
    body: { mode: 'sale_archive', startDate: '2026-09-01', endDate: '2026-09-30' }
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(sessions, 0);
});

test('sale archive source failures expose only a bounded diagnostic code', async () => {
  assert.equal(
    saleArchiveFailureCode(new Error('ASHK sale archive response has no trustworthy total_count')),
    'SOURCE_TOTAL_COUNT'
  );
  assert.equal(
    saleArchiveFailureCode(new Error('invalid sale money fact Sum for ASHK sale 1')),
    'SOURCE_MONEY_SUM'
  );
  assert.equal(
    saleArchiveFailureCode(new Error('invalid sale money fact Paid for ASHK sale 1')),
    'SOURCE_MONEY_PAID'
  );
  assert.equal(
    saleArchiveFailureCode(new Error('ASHK login failed: secret-response-body')),
    'SOURCE_AUTH'
  );
  assert.equal(saleArchiveFailureCode(new Error('unexpected secret value')), 'SOURCE_UNKNOWN');

  const handler = createGitHubSaleArchiveHandler({
    verifyToken: async () => CLAIMS,
    login: 'private-login', password: 'private-password',
    createSession: () => ({ requestJson() {} }),
    buildArchive: async () => {
      throw new Error('ASHK sale archive response has no trustworthy total_count: private-value');
    }
  });
  const res = responseRecorder();
  await handler({
    method: 'POST', headers: { authorization: 'Bearer oidc' },
    body: { mode: 'sale_archive', startDate: '2026-09-01', endDate: '2026-09-30' }
  }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, {
    ok: false,
    error: 'sale archive source failed',
    code: 'SOURCE_TOTAL_COUNT'
  });
  assert.equal(JSON.stringify(res.body).includes('private-value'), false);
});
