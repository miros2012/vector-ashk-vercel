import { probeCashPhotoGoogleOauthFromEnv } from './cash-photo-google-oauth-probe.js';

const ONE_TIME_RECOVERY = Object.freeze({
  key: 'YAMSKAYA_20260910',
  branch: 'Ямская',
  photoId: 'PHOTO-20260910-134422-315df084'
});

function header(req, name) {
  const headers = req?.headers || {};
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()] ?? '';
}

function requestParam(req, name) {
  try {
    const url = new URL(String(req?.url || ''), 'https://vector.invalid');
    return String(url.searchParams.get(name) || '').trim();
  } catch {
    return '';
  }
}

async function executeRetry(retryService, filters, res) {
  try {
    const result = await retryService.retryPending(1, filters);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('cash photo retry failed', error?.name || 'Error');
    return res.status(503).json({
      ok: false,
      error: 'cash_photo_retry_unavailable',
      message: 'Распознавание временно недоступно. Фото сохранено.'
    });
  }
}

export function createCashPhotoRetryHttpHandler({
  authorize,
  retryService,
  probeGoogleOauth = probeCashPhotoGoogleOauthFromEnv
} = {}) {
  if (typeof authorize !== 'function') throw new Error('Cash photo authorizer is required');
  if (!retryService?.retryPending) throw new Error('Cash photo retry service is required');
  if (typeof probeGoogleOauth !== 'function') throw new Error('Google OAuth probe is required');

  return async function cashPhotoRetryHttpHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const method = String(req?.method || '').toUpperCase();

    if (method === 'GET' && requestParam(req, 'diagnostic') === 'GOOGLE_OAUTH') {
      try {
        const result = await probeGoogleOauth();
        return res.status(200).json({
          ok: true,
          googleGeminiOauthAvailable: Boolean(result?.ok),
          upstreamStatus: Number(result?.status || 0)
        });
      } catch (error) {
        console.error('cash photo Google OAuth probe failed', error?.name || 'Error');
        return res.status(503).json({
          ok: false,
          error: 'google_gemini_oauth_probe_failed'
        });
      }
    }

    if (method === 'GET' && requestParam(req, 'recovery') === ONE_TIME_RECOVERY.key) {
      return executeRetry(retryService, {
        branch: ONE_TIME_RECOVERY.branch,
        photoId: ONE_TIME_RECOVERY.photoId,
        allowFailed: true
      }, res);
    }

    if (method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const suppliedToken = String(header(req, 'x-cash-photo-token') || '');
    const credential = suppliedToken ? await authorize(suppliedToken) : null;
    if (!credential?.branch) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const photoId = String(header(req, 'x-cash-photo-id') || '').trim();
    return executeRetry(retryService, {
      branch: String(credential.branch).trim(),
      photoId
    }, res);
  };
}
