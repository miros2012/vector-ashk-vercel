import test from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../lib/cash-photo-recognizer.js');
const { recognizeWithFallback, CashPhotoRecognitionUnavailableError } = mod;

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); }
  };
}

test('retries transient errors with increasing delay then succeeds', async () => {
  const calls = [];
  const sleeps = [];
  const fetchImpl = async (_url, init) => {
    calls.push(JSON.parse(init.body).model);
    if (calls.length === 1) return response(503, { error: { message: 'high demand' } });
    if (calls.length === 2) return response(500, { error: { message: 'internal' } });
    return response(200, { choices: [{ message: { content: '{"operations":[]}' } }] });
  };

  const result = await recognizeWithFallback({
    token: 'oidc',
    payload: { messages: [] },
    models: ['google/gemini-3.8-flash'],
    fetchImpl,
    sleepImpl: async (ms) => sleeps.push(ms),
    randomImpl: () => 0,
    maxAttemptsPerModel: 3,
    baseDelayMs: 100
  });

  assert.equal(result.model, 'google/gemini-3.8-flash');
  assert.deepEqual(calls, ['google/gemini-3.8-flash','google/gemini-3.8-flash','google/gemini-3.8-flash']);
  assert.deepEqual(sleeps, [100, 200]);
});

test('falls back to next model after transient retries are exhausted', async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const model = JSON.parse(init.body).model;
    calls.push(model);
    if (model === 'google/gemini-3.8-flash') return response(503, { error: { message: 'unavailable' } });
    return response(200, { choices: [{ message: { content: '{"operations":[{"date":"10.09.2026"}]}' } }] });
  };

  const result = await recognizeWithFallback({
    token: 'oidc', payload: { messages: [] },
    models: ['google/gemini-3.8-flash','google/gemini-3.5-flash'],
    fetchImpl, sleepImpl: async () => {}, randomImpl: () => 0,
    maxAttemptsPerModel: 2, baseDelayMs: 1
  });

  assert.equal(result.model, 'google/gemini-3.5-flash');
  assert.deepEqual(calls, ['google/gemini-3.8-flash','google/gemini-3.8-flash','google/gemini-3.5-flash']);
});

test('does not retry non-transient client errors', async () => {
  let calls = 0;
  await assert.rejects(
    recognizeWithFallback({
      token: 'oidc', payload: { messages: [] }, models: ['google/gemini-3.8-flash'],
      fetchImpl: async () => { calls += 1; return response(400, { error: { message: 'bad request' } }); },
      sleepImpl: async () => {}, randomImpl: () => 0
    }),
    /400/
  );
  assert.equal(calls, 1);
});

test('exhausted transient failures expose safe message and keep diagnostics separate', async () => {
  let caught;
  try {
    await recognizeWithFallback({
      token: 'oidc', payload: { messages: [] }, models: ['google/gemini-3.8-flash'],
      fetchImpl: async () => response(500, { error: { message: 'Internal error encountered secret-debug' } }),
      sleepImpl: async () => {}, randomImpl: () => 0,
      maxAttemptsPerModel: 2, baseDelayMs: 1
    });
  } catch (error) { caught = error; }

  assert.ok(caught instanceof CashPhotoRecognitionUnavailableError);
  assert.equal(caught.retryable, true);
  assert.match(caught.publicMessage, /временно недоступно/i);
  assert.doesNotMatch(caught.publicMessage, /gemini|500|secret-debug/i);
  assert.match(caught.diagnostics.join('\n'), /500/);
  assert.match(caught.diagnostics.join('\n'), /secret-debug/);
});

test('extracts JSON object from successful gateway response', async () => {
  const result = await recognizeWithFallback({
    token: 'oidc', payload: { messages: [] }, models: ['google/gemini-3.8-flash'],
    fetchImpl: async () => response(200, { choices: [{ message: { content: '{"initialBalance":10,"operations":[{"date":"10.09.2026"}]}' } }] }),
    sleepImpl: async () => {}, randomImpl: () => 0
  });
  assert.equal(result.data.initialBalance, 10);
  assert.equal(result.data.operations.length, 1);
});
