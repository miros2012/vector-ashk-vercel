import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  privateDecrypt,
  publicEncrypt,
  randomBytes
} from 'node:crypto';

const FORMAT = 'vector-ashk-payment-archive-encrypted-v1';
const AAD = Buffer.from(FORMAT, 'utf8');

function requiredKey(value, name) {
  const key = String(value ?? '').trim();
  if (!key) throw new Error(`${name} is required`);
  return key;
}

function requiredBase64(value, name) {
  const text = String(value ?? '').trim();
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error(`${name} is invalid`);
  return Buffer.from(text, 'base64');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function encryptPaymentArchive(archive, { publicKey } = {}) {
  const plaintext = Buffer.from(JSON.stringify(archive), 'utf8');
  const contentKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', contentKey, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encryptedKey = publicEncrypt({
    key: requiredKey(publicKey, 'publicKey'),
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256'
  }, contentKey);

  return {
    format: FORMAT,
    keyAlgorithm: 'RSA-OAEP-SHA256',
    contentAlgorithm: 'AES-256-GCM',
    plaintextSha256: sha256(plaintext),
    encryptedKey: encryptedKey.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

export function decryptPaymentArchive(envelope, { privateKey } = {}) {
  try {
    if (envelope?.format !== FORMAT
      || envelope?.keyAlgorithm !== 'RSA-OAEP-SHA256'
      || envelope?.contentAlgorithm !== 'AES-256-GCM') {
      throw new Error('encrypted archive format is invalid');
    }
    const contentKey = privateDecrypt({
      key: requiredKey(privateKey, 'privateKey'),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    }, requiredBase64(envelope.encryptedKey, 'encryptedKey'));
    const decipher = createDecipheriv(
      'aes-256-gcm',
      contentKey,
      requiredBase64(envelope.iv, 'iv')
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(requiredBase64(envelope.authTag, 'authTag'));
    const plaintext = Buffer.concat([
      decipher.update(requiredBase64(envelope.ciphertext, 'ciphertext')),
      decipher.final()
    ]);
    if (sha256(plaintext) !== String(envelope.plaintextSha256 || '')) {
      throw new Error('archive checksum mismatch');
    }
    return JSON.parse(plaintext.toString('utf8'));
  } catch (error) {
    throw new Error(`archive decryption failed: ${String(error?.message || error)}`);
  }
}
