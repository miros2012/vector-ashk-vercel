import { pathToFileURL } from 'node:url';

const ENDPOINT = 'https://vector-ashk-backend.vercel.app/api/health';
const AUDIENCE = 'vector-cash-photo-smoke-v1';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function runCashPhotoSmoke({ env = process.env, fetchImpl = fetch, sleep = wait, write = console.log } = {}) {
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error('cash_photo_smoke_runner_unconfigured');
  }
  const tokenUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (tokenUrl.protocol !== 'https:' || !tokenUrl.hostname.endsWith('.actions.githubusercontent.com')
      || tokenUrl.username || tokenUrl.password || tokenUrl.port) throw new Error('cash_photo_smoke_oidc_url_invalid');
  tokenUrl.searchParams.set('audience', AUDIENCE);
  let pending = 0;
  for (let attempt = 0; attempt < 18; attempt++) {
    if (attempt) await sleep(10000);
    let response, body;
    try {
      const tokenResponse = await fetchImpl(tokenUrl.href, {
        headers: { authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
        redirect: 'error', signal: AbortSignal.timeout(10000)
      });
      if (!tokenResponse.ok) throw new Error('OIDC unavailable');
      const token = (await tokenResponse.json()).value;
      if (typeof token !== 'string' || !token) throw new Error('OIDC missing');
      response = await fetchImpl(ENDPOINT, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'cash_photo_smoke' }), redirect: 'error', signal: AbortSignal.timeout(65000)
      });
      body = await response.json();
    } catch { throw new Error('cash_photo_smoke_transport_failed'); }
    if ((response.status === 409 && body?.error === 'deployment_not_current')
        || (response.status === 200 && body?.service === 'vector-ashk-backend' && !body?.mode)) {
      write('Waiting for the matching production deployment.'); continue;
    }
    if (response.status === 202 && body?.error === 'recognition_pending') {
      if (++pending === 3) throw new Error('cash_photo_recognition_pending');
      write('Test photo saved; recognition is pending.'); continue;
    }
    if (response.status !== 200) throw new Error(`cash_photo_smoke_http_${Number(response.status) || 0}`);
    const checks = body?.checks;
    if (body?.ok !== true || body?.mode !== 'cash_photo_smoke' || body?.deploymentSha !== env.GITHUB_SHA
        || !response.headers.get('cache-control')?.includes('no-store')
        || checks?.driveReadback !== true || checks?.archiveReadback !== true
        || checks?.duplicatePrevented !== true || checks?.operations !== 0) {
      throw new Error('cash_photo_smoke_attestation_invalid');
    }
    // Only fixed, checked fields are logged. Never echo an arbitrary server body.
    const result = {
      ok: true, deploymentSha: env.GITHUB_SHA, newUpload: body.newUpload === true,
      checks: { driveReadback: true, archiveReadback: true, duplicatePrevented: true, operations: 0 }
    };
    write(JSON.stringify(result));
    return result;
  }
  throw new Error('cash_photo_deployment_timeout');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCashPhotoSmoke().catch(error => {
    const code = /^cash_photo_[a-z_0-9]+$/.test(error.message) ? error.message : 'cash_photo_smoke_failed';
    console.error(code); process.exitCode = 1;
  });
}
