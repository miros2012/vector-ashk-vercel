function header(req, name) {
  const headers = req?.headers || {};
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()] ?? '';
}

export function createCashPhotoConfigHttpHandler({ authorize, now = () => new Date(), maxBytes = 4 * 1024 * 1024 } = {}) {
  if (typeof authorize !== 'function') throw new Error('Cash photo authorizer is required');

  return async function cashPhotoConfigHttpHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req?.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }
    const token = String(header(req, 'x-cash-photo-token') || '');
    const credential = token ? await authorize(token) : null;
    const shared = credential?.role === 'Сотрудники' && Array.isArray(credential.branches) && credential.branches.length > 0;
    if (!credential?.branch && !shared) return res.status(403).json({ ok: false, error: 'forbidden' });

    return res.status(200).json({
      ok: true,
      ...(shared ? { branches: credential.branches.map(item => ({ branch: String(item.branch), label: String(item.label || item.branch) })) }
        : { branch: String(credential.branch), label: String(credential.label || credential.branch) }),
      year: now().getUTCFullYear(),
      maxBytes
    });
  };
}
