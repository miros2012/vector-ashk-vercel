import { readFile as readFileFromDisk, writeFile as writeFileToDisk } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encryptPaymentArchive } from '../lib/payment-archive-encryption.js';
import { verifyAshkPaymentArchive } from '../lib/ashk-payment-archive.js';

const OIDC_AUDIENCE = 'vector-finance-sync-v1';
export const ARCHIVE_CLIENT_TIMEOUT_MS = 250_000;

function requiredEnvironment(env, name) {
  const value = String(env?.[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function oidcToken({ fetchFn, env }) {
  const requestUrl = new URL(requiredEnvironment(env, 'ACTIONS_ID_TOKEN_REQUEST_URL'));
  requestUrl.searchParams.set('audience', OIDC_AUDIENCE);
  const response = await fetchFn(requestUrl, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${requiredEnvironment(env, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN')}`,
      accept: 'application/json'
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response?.ok) throw new Error(`OIDC request failed: ${response?.status || 'unknown'}`);
  const token = String((await response.json())?.value || '').trim();
  if (!token) throw new Error('OIDC token missing');
  return token;
}

export async function exportAshkPaymentArchive({
  fetchFn = globalThis.fetch,
  env = process.env,
  readFile = readFileFromDisk,
  writeFile = writeFileToDisk,
  logger = console
} = {}) {
  if (typeof fetchFn !== 'function') throw new Error('fetch is required');
  if (typeof readFile !== 'function') throw new Error('readFile is required');
  if (typeof writeFile !== 'function') throw new Error('writeFile is required');

  const startDate = requiredEnvironment(env, 'ARCHIVE_START_DATE');
  const endDate = requiredEnvironment(env, 'ARCHIVE_END_DATE');
  const endpoint = requiredEnvironment(env, 'PAYMENT_ARCHIVE_ENDPOINT');
  const outputPath = requiredEnvironment(env, 'ARCHIVE_OUTPUT_PATH');
  const publicKeyPath = requiredEnvironment(env, 'ARCHIVE_PUBLIC_KEY_PATH');
  const token = await oidcToken({ fetchFn, env });
  const response = await fetchFn(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({ mode: 'payment_archive', startDate, endDate }),
    signal: AbortSignal.timeout(ARCHIVE_CLIENT_TIMEOUT_MS)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true || body?.mode !== 'read_only_payment_archive') {
    throw new Error(`payment archive request failed: ${response.status}`);
  }
  const verifiedEvidence = verifyAshkPaymentArchive(body);

  const publicKey = await readFile(publicKeyPath, 'utf8');
  const encryptedArchive = encryptPaymentArchive({
    ok: true,
    mode: 'read_only_payment_archive',
    ...verifiedEvidence
  }, { publicKey });
  await writeFile(outputPath, `${JSON.stringify(encryptedArchive, null, 2)}\n`, 'utf8');
  logger.log(JSON.stringify({
    ok: true,
    period: body.period,
    rows: body.summary?.rows,
    sha256: body.sha256,
    artifactWritten: true
  }));
  return { outputPath, summary: body.summary, sha256: body.sha256 };
}

async function main() {
  await exportAshkPaymentArchive();
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
