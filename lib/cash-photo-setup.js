import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CASH_PHOTO_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export async function startCashPhotoConsent({ auth, timeoutMs = 300000 } = {}) {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  let resolve, reject, timer, consumed = false;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  result.catch(() => {});
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Connection', 'close');
    const url = new URL(req.url, redirectUri);
    const incoming = Buffer.from(url.searchParams.get('state') || '');
    if (req.method !== 'GET' || req.headers.host !== new URL(redirectUri).host || url.pathname !== '/callback'
      || incoming.length !== state.length || !timingSafeEqual(incoming, Buffer.from(state)) || consumed) {
      res.writeHead(400); res.end('Invalid authorization request.'); return;
    }
    consumed = true;
    clearTimeout(timer);
    if (url.searchParams.has('error') || !url.searchParams.get('code')) {
      res.writeHead(400); res.end('Google consent was not granted.');
      reject(new Error('Google consent was not granted')); return;
    }
    try {
      const { tokens } = await auth.getToken({ code: url.searchParams.get('code'), codeVerifier: verifier, redirect_uri: redirectUri });
      if (!tokens.refresh_token || !String(tokens.scope || '').split(' ').includes(CASH_PHOTO_DRIVE_SCOPE)) throw new Error();
      res.end('Google подключён. Вернитесь в терминал.');
      resolve(tokens);
    } catch {
      res.writeHead(400); res.end('Google connection failed. Return to the terminal.');
      reject(new Error('Google connection failed; no usable offline Drive permission'));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const url = auth.generateAuthUrl({
    redirect_uri: redirectUri, scope: CASH_PHOTO_DRIVE_SCOPE, access_type: 'offline', prompt: 'consent',
    state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256'
  });
  timer = setTimeout(() => { reject(new Error('Google consent timed out')); server.close(); }, timeoutMs);
  return { url, redirectUri, result, async close() { clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

export async function provisionCashPhotoFolder({ drive, serviceAccountEmail } = {}) {
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(serviceAccountEmail || '')) throw new Error('Invalid service account');
  const response = await drive.files.list({
    q: "trashed = false and 'me' in owners and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='vectorCashPhoto' and value='v1' }",
    spaces: 'drive', fields: 'files(id),nextPageToken', pageSize: 2
  });
  const folders = response.data?.files || [];
  if (folders.length > 1 || response.data?.nextPageToken) throw new Error('Multiple app folders; select one before continuing');
  let folderId = folders[0]?.id;
  if (!folderId) {
    const created = await drive.files.create({ requestBody: {
      name: 'Кассовые фото — загрузка API', mimeType: 'application/vnd.google-apps.folder', appProperties: { vectorCashPhoto: 'v1' }
    }, fields: 'id' });
    folderId = created.data?.id;
  }
  if (!folderId) throw new Error('Google did not create the upload folder');
  await drive.permissions.create({ fileId: folderId, sendNotificationEmail: false, requestBody: { type: 'user', role: 'reader', emailAddress: serviceAccountEmail }, fields: 'id' });
  return folderId;
}

export function buildCashPhotoAccess(branches) {
  const registry = [], links = [];
  for (const branch of branches) {
    const token = randomBytes(32).toString('base64url');
    registry.push({ ...branch, active: true, tokenSha256: createHash('sha256').update(token).digest('hex') });
    links.push({ branch: branch.branch, url: `https://vector-ashk-backend.vercel.app/cash-upload.html#token=${token}` });
  }
  return { registry, links };
}

export async function saveCashPhotoSecrets({ directory, env, links }) {
  const lines = Object.entries(env).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || typeof value !== 'string' || /['\r\n]/.test(value)) throw new Error('Invalid private configuration format');
    return `${key}='${value}'`;
  });
  // Exclusive directory creation also prevents accidental credential replacement.
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'vercel.env'), lines.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  await writeFile(join(directory, 'branch-links.txt'), links.map(({ branch, url }) => `${branch}\n${url}`).join('\n\n') + '\n', { mode: 0o600, flag: 'wx' });
}
