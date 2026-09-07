import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const probe = String.raw`
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'trace@example.invalid';
process.env.GOOGLE_PRIVATE_KEY = 'dummy-private-key';
process.env.VECTOR_SYNC_KEY = 'expected-key';

const { default: handler } = await import('./api/decision-event.js');
const response = {
  code: 0,
  body: null,
  setHeader() {},
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; }
};

await handler({
  method: 'GET',
  query: { ownerRoute: 'package' },
  headers: { 'x-vector-key': 'wrong-key' }
}, response);

if (response.code !== 403) {
  throw new Error('expected protected owner package probe to return 403');
}
`;

test('protected owner package path emits no Node 24 legacy url deprecation', () => {
  const result = spawnSync(process.execPath, [
    '--trace-deprecation',
    '--input-type=module',
    '-e',
    probe
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout || 'probe failed');
  assert.ok(
    !result.stderr.includes('[DEP0169]'),
    `Node 24 DEP0169 trace:\n${result.stderr}`
  );
});
