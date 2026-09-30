import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RECOVERY_AUDIENCE = 'vector-finance-sync-v1';
const RECOVERY_BODY = JSON.stringify({ mode: 'finance_sync', kind: 'recovery' });
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const RETRYABLE_CHECKPOINT_ERRORS = new Set([
  undefined,
  'CHECKPOINT_FAILED',
  'CYCLE_UNAVAILABLE',
  'TRANSPORT_FAILED'
]);
const RETRYABLE_SOURCE_ERRORS = new Set([
  'REPORT_TRANSPORT',
  'DDS_TRANSPORT',
  'HOURS_TRANSPORT'
]);
const RETRYABLE_DOWNSTREAM_ERRORS = new Set([
  'REPORT_STALE',
  'DATA_HEALTH_BLOCKED'
]);

function requiredEnvironment(env, name) {
  const value = String(env?.[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function retryableFailure(response, body) {
  if (!RETRYABLE_STATUS_CODES.has(response.status) || body?.blocked) return false;
  const errorClass = body?.errorClass;
  if (!body?.attempt && RETRYABLE_CHECKPOINT_ERRORS.has(errorClass)) return true;
  return (RETRYABLE_SOURCE_ERRORS.has(errorClass) || RETRYABLE_DOWNSTREAM_ERRORS.has(errorClass))
    && Number.isInteger(body?.attempt)
    && body.attempt > 0
    && body.attempt < 3;
}

async function githubOidcToken({ fetchFn, env }) {
  const requestUrl = new URL(requiredEnvironment(env, 'ACTIONS_ID_TOKEN_REQUEST_URL'));
  requestUrl.searchParams.set('audience', RECOVERY_AUDIENCE);
  const tokenResponse = await fetchFn(requestUrl, {
    headers: {
      authorization: `Bearer ${requiredEnvironment(env, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN')}`
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!tokenResponse.ok) throw new Error(`OIDC request failed: ${tokenResponse.status}`);
  const token = String((await tokenResponse.json())?.value || '').trim();
  if (!token) throw new Error('OIDC token missing');
  return token;
}

export async function drainFinanceRecovery({
  fetchFn = globalThis.fetch,
  env = process.env,
  sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms)),
  logger = console,
  maxSteps = 24
} = {}) {
  if (typeof fetchFn !== 'function') throw new Error('fetch is required');
  const endpoint = requiredEnvironment(env, 'FINANCE_SYNC_ENDPOINT');
  let transientFailures = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    // GitHub OIDC tokens are intentionally refreshed for every separately
    // checkpointed stage instead of being reused across a long recovery run.
    const token = await githubOidcToken({ fetchFn, env });
    let response;
    try {
      response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: RECOVERY_BODY,
        signal: AbortSignal.timeout(315_000)
      });
    } catch {
      response = {
        ok: false,
        status: 503,
        json: async () => ({ ok: false, errorClass: 'TRANSPORT_FAILED' })
      };
    }

    const body = await response.json().catch(() => ({}));
    if (response.status === 409 && body?.busy === true) {
      logger.log('Finance lease busy; next scheduled recovery will resume.');
      return { status: 'busy', steps: step + 1 };
    }

    if (!response.ok || body?.ok !== true) {
      transientFailures += 1;
      if (retryableFailure(response, body) && transientFailures < 3 && step < maxSteps - 1) {
        logger.log(JSON.stringify({
          retry: true,
          status: response.status,
          errorClass: body?.errorClass || 'TRANSPORT_FAILED'
        }));
        const delayMs = RETRYABLE_SOURCE_ERRORS.has(body?.errorClass) ? 30_000 : 2_000;
        await sleep(delayMs * transientFailures);
        continue;
      }
      throw new Error(
        `Finance recovery failed: ${response.status}; `
        + `stage=${body?.stage || 'unknown'}; error=${body?.errorClass || 'unknown'}`
      );
    }

    transientFailures = 0;
    logger.log(JSON.stringify({
      ok: true,
      stage: body?.stage || null,
      pending: body?.pending === true,
      complete: body?.complete === true
    }));

    if (body?.pending !== true || body?.deferred === true) {
      return {
        status: body?.deferred === true ? 'deferred' : 'complete',
        steps: step + 1,
        body
      };
    }

    // These boundaries follow stages with many Sheets reads. Let the
    // per-user minute quota refill before the next heavy stage.
    if ((body.stage === 'payments' && body.nextStage === 'hours')
      || (body.stage === 'balances' && body.nextStage === 'reportVerification')) {
      await sleep(65_000);
    }

    if (step === maxSteps - 1) {
      throw new Error('Finance continuation limit reached; checkpoint retained');
    }
  }

  throw new Error('Finance continuation limit reached; checkpoint retained');
}

async function main() {
  await drainFinanceRecovery();
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
