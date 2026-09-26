import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInternalOwnerActionKey } from '../lib/internal-owner-action-key.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('internal owner-action keys are non-empty and unique per invocation', () => {
  const first = createInternalOwnerActionKey();
  const second = createInternalOwnerActionKey();

  assert.match(first, /^internal-owner-action:[0-9a-f-]{36}$/);
  assert.match(second, /^internal-owner-action:[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
});

test('internal queue composition works without exposing an external fallback credential', () => {
  const script = String.raw`
    import assert from 'node:assert/strict';
    import { google } from 'googleapis';
    import handler, { processOwnerActionQueue } from './api/decision-event.js';

    const reads = [];
    const writes = [];
    const decision = Array(22).fill('');
    decision[0] = 'DEC-TEST';
    decision[9] = 'Активно';
    decision[10] = 'Не начато';

    google.sheets = () => ({
      spreadsheets: {
        values: {
          async get(args) {
            reads.push(args);
            return {
              data: {
                values: args.range.includes('Owner Action Queue')
                  ? [['request-1', 'DEC-TEST', 'В работу', 'Не начато', 'Owner', '', '', '', '', 'READY']]
                  : []
              }
            };
          },
          async batchGet(args) {
            reads.push(args);
            return { data: { valueRanges: [{ values: [decision] }, { values: [] }] } };
          },
          async batchUpdate(args) {
            writes.push(args);
            return { data: {} };
          }
        }
      }
    });

    for (let index = 0; index < 2; index += 1) {
      assert.deepEqual(await processOwnerActionQueue(), {
        ok: true, staged: 0, ready: 1, succeeded: 1, failed: 0
      });
    }

    assert.equal(writes.length, 6);
    assert.equal(writes.filter((write) =>
      write.requestBody.data.some((item) => item.range.includes('История решений'))
    ).length, 2);
    assert.equal(JSON.stringify({ reads, writes }).includes('internal-owner-action:'), false);

    const readsBeforeExternalRequests = reads.length;
    const rejectedKeys = [
      '',
      'owner-action-internal-only',
      'internal-owner-action:00000000-0000-4000-8000-000000000000'
    ];

    for (const route of ['', 'queue', 'action', 'effectiveness']) {
      for (const key of rejectedKeys) {
        const response = {
          code: null,
          body: null,
          setHeader() {},
          status(code) { this.code = code; return this; },
          json(body) { this.body = body; return this; }
        };
        await handler({
          method: ['action', 'effectiveness'].includes(route) ? 'GET' : 'POST',
          query: { ownerRoute: route },
          headers: { 'x-vector-key': key },
          body: {}
        }, response);
        assert.equal(response.code, 403);
        assert.deepEqual(response.body, { ok: false, error: 'forbidden' });
      }
    }

    assert.equal(reads.length, readsBeforeExternalRequests);
  `;

  const env = {
    ...process.env,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.invalid',
    GOOGLE_PRIVATE_KEY: 'test-placeholder'
  };
  delete env.VECTOR_SYNC_KEY;
  delete env.TOCHKA_BRIDGE_KEY;

  const result = spawnSync(process.execPath, ['--input-type=module'], {
    cwd: root,
    env,
    input: script,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
