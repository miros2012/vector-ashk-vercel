import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requestBearer,
  authorizeBearer,
  authorizeHeader
} from '../lib/request-authorization.js';

test('requestBearer accepts one case-insensitive trimmed Bearer token', () => {
  assert.equal(requestBearer({ headers: { authorization: 'Bearer exact-secret' } }), 'exact-secret');
  assert.equal(requestBearer({ headers: { authorization: 'bEaReR   exact-secret  ' } }), 'exact-secret');
});

test('requestBearer rejects missing, malformed, empty, and multi-part credentials', () => {
  for (const authorization of [undefined, '', 'Basic exact-secret', 'Bearer', 'Bearer one two']) {
    assert.equal(requestBearer({ headers: { authorization } }), '');
  }
});

test('authorizeBearer requires a non-empty configured secret and exact token', () => {
  const req = { headers: { authorization: 'Bearer exact-secret' } };
  assert.equal(authorizeBearer(req, 'exact-secret'), true);
  assert.equal(authorizeBearer(req, 'wrong-secret'), false);
  assert.equal(authorizeBearer(req, ''), false);
  assert.equal(authorizeBearer({ headers: {} }, 'exact-secret'), false);
});

test('authorizeHeader requires exact non-empty custom header and configured secret', () => {
  const req = { headers: { 'x-vector-key': 'bridge-secret' } };
  assert.equal(authorizeHeader(req, 'x-vector-key', 'bridge-secret'), true);
  assert.equal(authorizeHeader(req, 'x-vector-key', 'wrong-secret'), false);
  assert.equal(authorizeHeader(req, 'x-vector-key', ''), false);
  assert.equal(authorizeHeader({ headers: {} }, 'x-vector-key', 'bridge-secret'), false);
});
