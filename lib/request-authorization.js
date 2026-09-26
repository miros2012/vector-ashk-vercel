import { timingSafeSecretEqual } from './secret-compare.js';

export function requestBearer(req) {
  const authorization = String(req?.headers?.authorization ?? '');
  const match = authorization.match(/^Bearer\s+(\S+)\s*$/i);
  return match?.[1] || '';
}

export function authorizeBearer(req, expectedSecret) {
  const expected = String(expectedSecret ?? '').trim();
  const actual = requestBearer(req);
  return Boolean(expected && actual) && timingSafeSecretEqual(actual, expected);
}

export function authorizeHeader(req, headerName, expectedSecret) {
  const name = String(headerName ?? '').trim().toLowerCase();
  const expected = String(expectedSecret ?? '').trim();
  const actual = String(req?.headers?.[name] ?? '').trim();
  return Boolean(name && expected && actual) && timingSafeSecretEqual(actual, expected);
}
