import { google } from 'googleapis';

const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1/models';
const GEMINI_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/generative-language.retriever'
];

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function projectIdFromServiceAccountEmail(email) {
  const match = String(email || '').trim().match(/@([^.]+)\.iam\.gserviceaccount\.com$/);
  return match ? match[1] : '';
}

async function safeJson(response) {
  if (typeof response?.json !== 'function') return {};
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function classifyFailure(status, payload) {
  if (status >= 200 && status < 300) return 'OK';
  const errorStatus = String(payload?.error?.status || '').toUpperCase();
  const message = String(payload?.error?.message || '');
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
  const detailReasons = details.map(detail => String(detail?.reason || '').toUpperCase());

  if (
    detailReasons.includes('SERVICE_DISABLED')
    || /has not been used.+project|api.+disabled|service.+disabled/i.test(message)
  ) {
    return 'API_DISABLED';
  }
  if (/serviceusage\.services\.use/i.test(message)) return 'SERVICE_USAGE_DENIED';
  if (status === 401 || errorStatus === 'UNAUTHENTICATED') return 'AUTHENTICATION_FAILED';
  if (status === 403 || errorStatus === 'PERMISSION_DENIED') return 'PERMISSION_DENIED';
  return 'UPSTREAM_ERROR';
}

export function createCashPhotoGoogleOauthProbe({ projectId, authorize, fetchImpl = fetch } = {}) {
  if (!projectId) throw new Error('Google Cloud project id is required');
  if (typeof authorize !== 'function') throw new Error('Google OAuth authorizer is required');
  if (typeof fetchImpl !== 'function') throw new Error('Fetch implementation is required');

  return async function probeGoogleOauth() {
    const credentials = await authorize();
    const accessToken = String(credentials?.access_token || credentials?.token || '').trim();
    if (!accessToken) throw new Error('Google OAuth access token is unavailable');

    const response = await fetchImpl(GEMINI_MODELS_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-goog-user-project': projectId
      }
    });
    const status = Number(response?.status || 0);
    const payload = await safeJson(response);
    return {
      ok: Boolean(response?.ok),
      status,
      reason: classifyFailure(status, payload)
    };
  };
}

export async function probeCashPhotoGoogleOauthFromEnv({ fetchImpl = fetch } = {}) {
  const email = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const key = privateKey();
  const projectId = String(process.env.GOOGLE_CLOUD_PROJECT_ID || '').trim()
    || projectIdFromServiceAccountEmail(email);
  if (!email || !key) throw new Error('Google service account secrets missing');
  if (!projectId) throw new Error('Google Cloud project id is unavailable');

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: GEMINI_OAUTH_SCOPES
  });
  const probe = createCashPhotoGoogleOauthProbe({
    projectId,
    authorize: () => auth.authorize(),
    fetchImpl
  });
  return probe();
}
