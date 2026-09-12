import { cashPhotoRequestBranch } from './cash-photo-request-branch.js';

function header(req, name) {
  const headers = req?.headers || {};
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()] ?? '';
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
  retryService
} = {}) {
  if (typeof authorize !== 'function') throw new Error('Cash photo authorizer is required');
  if (!retryService?.retryPending) throw new Error('Cash photo retry service is required');

  return async function cashPhotoRetryHttpHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const method = String(req?.method || '').toUpperCase();

    if (method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const suppliedToken = String(header(req, 'x-cash-photo-token') || '');
    const credential = suppliedToken ? await authorize(suppliedToken) : null;
    const branch = cashPhotoRequestBranch(credential, req);
    if (!branch) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const photoId = String(header(req, 'x-cash-photo-id') || '').trim();
    return executeRetry(retryService, {
      branch,
      photoId
    }, res);
  };
}
