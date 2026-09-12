import { cashPhotoRequestBranch } from './cash-photo-request-branch.js';

function header(req, name) {
  const headers = req?.headers || {};
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()] ?? '';
}

function decodeHeader(value) {
  try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); }
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req?.body)) return req.body;
  if (req?.body instanceof Uint8Array) return Buffer.from(req.body);
  if (typeof req?.body === 'string') return Buffer.from(req.body, 'binary');
  const chunks = [];
  if (req && typeof req[Symbol.asyncIterator] === 'function') {
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function createCashPhotoUploadHttpHandler({ authorize, uploadService } = {}) {
  if (typeof authorize !== 'function') throw new Error('Cash photo authorizer is required');
  if (!uploadService?.upload) throw new Error('Cash photo upload service is required');

  return async function cashPhotoUploadHttpHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req?.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const suppliedToken = String(header(req, 'x-cash-photo-token') || '');
    const credential = suppliedToken ? await authorize(suppliedToken) : null;
    const branch = cashPhotoRequestBranch(credential, req);
    if (!branch) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    try {
      const result = await uploadService.upload({
        imageBytes: await readRawBody(req),
        mimeType: String(header(req, 'content-type') || '').split(';')[0].trim().toLowerCase(),
        branch,
        year: Number(header(req, 'x-cash-year')),
        fileName: decodeHeader(header(req, 'x-cash-file-name')).trim()
      });
      return res.status(result.statusCode || 200).json(result.body || { ok: true });
    } catch (error) {
      console.error('cash photo upload failed');
      return res.status(500).json({
        ok: false,
        error: 'cash_photo_upload_failed',
        message: 'Сервис загрузки временно недоступен. Повторите отправку позже.'
      });
    }
  };
}
