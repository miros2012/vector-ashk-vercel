import { createHash, timingSafeEqual } from 'node:crypto';

function secretDigest(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest();
}

export function timingSafeSecretEqual(actual, expected) {
  return timingSafeEqual(secretDigest(actual), secretDigest(expected));
}
