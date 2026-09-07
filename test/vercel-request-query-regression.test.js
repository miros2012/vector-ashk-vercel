import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createManualFinanceRunHandler,
  hasManualFinanceRunToken
} from '../lib/manual-finance-run-handler.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Regression contract: production request parsing must not invoke Vercel's legacy req.query getter.
function throwingQueryRequest(url, method = 'GET') {
  const req = { method, headers: {}, url, originalUrl: url };
  Object.defineProperty(req, 'query', {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error('legacy req.query getter must not be touched');
    }
  });
  return req;
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; }
  };
}

test('manual finance token detection parses req.url without touching legacy req.query getter', () => {
  const req = throwingQueryRequest(
    '/api/nightly-finance-orchestrator?finance_run_token=single-use&source=manual'
  );

  assert.equal(hasManualFinanceRunToken(req), true);
});

test('manual finance handler strips token and forwards safe query without touching original getter', async () => {
  const events = [];
  const handler = createManualFinanceRunHandler({
    cronSecret: 'cron-secret',
    consumeToken: async token => {
      events.push(`consume:${token}`);
      return { ok: true };
    },
    runNightly: async (req, res) => {
      events.push('nightly');
      assert.deepEqual(req.query, { source: 'manual', source2: ['a', 'b'] });
      assert.equal(
        req.url,
        '/api/nightly-finance-orchestrator?source=manual&source2=a&source2=b'
      );
      return res.status(200).json({ ok: true });
    }
  });
  const req = throwingQueryRequest(
    '/api/nightly-finance-orchestrator?finance_run_token=single-use&source=manual&source2=a&source2=b'
  );
  const res = responseRecorder();

  await handler(req, res);

  assert.deepEqual(events, ['consume:single-use', 'nightly']);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('decision-event owner routing does not access Vercel req.query lazy parser', () => {
  const source = fs.readFileSync(path.join(here, '..', 'api', 'decision-event.js'), 'utf8');
  assert.doesNotMatch(source, /req\.query/);
  assert.match(source, /ownerRoute/);
});
