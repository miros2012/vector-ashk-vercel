import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const AUDIENCE = 'vector-cash-photo-smoke-v1';
const FIXTURE_HASH = 'd583bea9bd7dc9eabe321a6d7d628e15ba9c804806e577ba38a6457cd18d4c88';
const BRANCH = 'ТЕСТ ЗАГРУЗКИ';
const FILE_NAME = 'vector-upload-test.png';
const ARCHIVE_RANGE = "'Архив кассовых фото'!A2:N";
const EXPECTED = Object.freeze({
  iss: 'https://token.actions.githubusercontent.com',
  sub: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main',
  repository: 'miros2012/vector-ashk-vercel', repository_id: '1350493825',
  repository_owner_id: '46207692', actor_id: '46207692', ref: 'refs/heads/main',
  workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/test.yml@refs/heads/main',
  event_name: 'push', runner_environment: 'github-hosted'
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

function trusted(claims) {
  return claims && Object.entries(EXPECTED).every(([key, value]) => claims[key] === value)
    && (claims.aud === AUDIENCE || (Array.isArray(claims.aud) && claims.aud.includes(AUDIENCE)))
    && ['run_id', 'run_attempt'].every(key => /^[1-9]\d*$/.test(String(claims[key] || '')))
    && validSha(claims.sha) && claims.sha === claims.workflow_sha;
}

async function fixtureRows(services) {
  const result = await services.sheets.spreadsheets.values.get({
    spreadsheetId: services.spreadsheetId, range: ARCHIVE_RANGE
  });
  return (result?.data?.values || []).filter(row => row[6] === FIXTURE_HASH);
}

function assertFixtureRow(row) {
  if (!row || row[2] !== BRANCH || row[4] !== FILE_NAME || row[10]) {
    throw new Error('fixture identity mismatch');
  }
}

async function execute(services, deploymentSha) {
  // This immutable, nonfinancial fixture is the entire capability. Request data
  // never supplies an image, branch, filename, Drive id or archive row.
  const imageBytes = Buffer.from(await readFile(new URL('./cash-photo-smoke-fixture.base64', import.meta.url), 'utf8'), 'base64');
  if (hash(imageBytes) !== FIXTURE_HASH) throw new Error('fixture checksum mismatch');
  const before = await fixtureRows(services);
  if (before.length > 1) throw new Error('duplicate fixture rows');
  if (before.length) assertFixtureRow(before[0]);
  const input = { imageBytes, mimeType: 'image/png', branch: BRANCH, year: 2026, fileName: FILE_NAME };
  const result = await services.uploadService.upload(input);
  if (result.statusCode === 202 && result.body?.saved === true) {
    return { status: 202, body: { ok: false, mode: 'cash_photo_smoke', error: 'recognition_pending', deploymentSha } };
  }
  if (result.statusCode !== 200 || result.body?.ok !== true) throw new Error('upload incomplete');
  const rows = await fixtureRows(services);
  if (rows.length !== 1) throw new Error('archive fixture count mismatch');
  const row = rows[0]; assertFixtureRow(row);
  const recognition = JSON.parse(row[13]);
  if (row[0] !== result.body.photoId || row[7] !== 'Распознано — ожидает обработки'
      || Number(row[8]) !== 0 || Number(row[9]) !== 0 || !row[11]
      || !Array.isArray(recognition.operations) || recognition.operations.length !== 0) {
    throw new Error('archive recognition mismatch');
  }
  const photo = await services.store.findByHash(FIXTURE_HASH);
  if (!photo || photo.photoId !== row[0]) throw new Error('saved photo identity mismatch');
  const readback = await services.store.readPhoto(photo);
  if (hash(readback.imageBytes) !== FIXTURE_HASH) throw new Error('Drive readback mismatch');
  const duplicate = await services.uploadService.upload(input);
  const after = await fixtureRows(services);
  if (duplicate.statusCode !== 200 || duplicate.body?.alreadyStored !== true
      || duplicate.body.photoId !== row[0] || after.length !== 1
      || JSON.stringify(after[0]) !== JSON.stringify(row)) throw new Error('duplicate prevention failed');
  return { status: 200, body: {
    ok: true, mode: 'cash_photo_smoke', deploymentSha, newUpload: before.length === 0,
    photoId: photo.photoId,
    checks: { driveReadback: true, archiveReadback: true, duplicatePrevented: true, operations: 0 }
  } };
}

export function createCashPhotoSmokeHandler({ verifyToken, getServices, deploymentShaProvider = () => process.env.VERCEL_GIT_COMMIT_SHA } = {}) {
  return async function handleCashPhotoSmoke(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }
    const body = req.body;
    if (!body || body.mode !== 'cash_photo_smoke' || Object.keys(body).length !== 1) {
      return res.status(400).json({ ok: false, error: 'invalid_smoke_request' });
    }
    let claims;
    try {
      const authorization = req.headers?.authorization;
      const token = typeof authorization === 'string' && authorization.match(/^Bearer ([^\s]+)$/)?.[1];
      if (!token || token.length > 20000) throw new Error('missing token');
      claims = await verifyToken(token, { audience: AUDIENCE });
      if (!trusted(claims)) throw new Error('untrusted claims');
    } catch {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const deploymentSha = deploymentShaProvider();
    if (!validSha(deploymentSha) || deploymentSha !== claims.sha) {
      return res.status(409).json({ ok: false, error: 'deployment_not_current' });
    }
    try {
      const result = await execute(await getServices(), deploymentSha);
      return res.status(result.status).json(result.body);
    } catch {
      // No raw provider errors, tokens, image data or archive contents in logs.
      console.error('cash photo automatic smoke failed');
      return res.status(500).json({ ok: false, error: 'cash_photo_smoke_failed', deploymentSha });
    }
  };
}
