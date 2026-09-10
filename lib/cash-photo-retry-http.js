function header(req, name) {
  const headers = req?.headers || {};
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()] ?? '';
}

export function createCashPhotoRetryHttpHandler({ authorize, retryService } = {}) {
  if (typeof authorize !== 'function') throw new Error('Cash photo authorizer is required');
  if (!retryService?.retryPending) throw new Error('Cash photo retry service is required');

  return async function cashPhotoRetryHttpHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (String(req?.method || '').toUpperCase() !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const suppliedToken = String(header(req, 'x-cash-photo-token') || '');
    const credential = suppliedToken ? await authorize(suppliedToken) : null;
    if (!credential?.branch) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    try {
      const photoId = String(header(req, 'x-cash-photo-id') || '').trim();
      const result = await retryService.retryPending(1, {
        branch: String(credential.branch).trim(),
        photoId
      });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      console.error('cash photo retry failed', error?.name || 'Error');
      return res.status(503).json({
        ok: false,
        error: 'cash_photo_retry_unavailable',
        message: 'Распознавание временно недоступно. Фото сохранено.'
      });
    }
  };
}
