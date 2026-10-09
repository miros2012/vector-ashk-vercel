import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  decryptPaymentArchive,
  encryptPaymentArchive
} from '../lib/payment-archive-encryption.js';

function keyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

test('payment archive encryption round-trips financial facts without plaintext leakage', () => {
  const { publicKey, privateKey } = keyPair();
  const archive = {
    ok: true,
    payments: [{ Id: 'private-payment-id', Debit: -2700 }],
    sha256: 'a'.repeat(64)
  };
  const envelope = encryptPaymentArchive(archive, { publicKey });

  assert.equal(envelope.format, 'vector-ashk-payment-archive-encrypted-v1');
  assert.equal('plaintextSha256' in envelope, false);
  assert.equal(JSON.stringify(envelope).includes('private-payment-id'), false);
  assert.deepEqual(decryptPaymentArchive(envelope, { privateKey }), archive);
});

test('payment archive decryption fails closed after ciphertext tampering', () => {
  const { publicKey, privateKey } = keyPair();
  const envelope = encryptPaymentArchive({ payments: [] }, { publicKey });
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  ciphertext[0] ^= 1;
  assert.throws(
    () => decryptPaymentArchive({ ...envelope, ciphertext: ciphertext.toString('base64') }, { privateKey }),
    /unable to authenticate|archive decryption failed/i
  );
});
