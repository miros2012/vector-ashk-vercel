import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerReadonlyApi } from '../lib/owner-readonly-api.js';

function responseRecorder() {
  return {
    code: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('fails closed when both Owner credential channels contain values', async () => {
  for (const authorization of ['Bearer owner-secret', 'Basic unrelated-credential']) {
    let reads = 0;
    const api = createOwnerReadonlyApi({
      configuredKey: 'owner-secret',
      readOwnerPackage: async () => {
        reads += 1;
        return { summary: { safeWithdrawal: 0 } };
      }
    });
    const res = responseRecorder();

    await api({
      method: 'GET',
      headers: {
        'x-vector-key': 'owner-secret',
        authorization
      }
    }, res);

    assert.equal(res.code, 403);
    assert.deepEqual(res.body, { ok: false, error: 'forbidden' });
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(reads, 0);
  }
});
