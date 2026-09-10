import test from 'node:test';
import assert from 'node:assert/strict';
import { createCashPhotoUploadHttpHandler } from '../lib/cash-photo-upload-http.js';

function responseRecorder() {
  return {
    code: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

function req(overrides = {}) {
  return {
    method: 'POST',
    headers: {
      'x-cash-photo-token': 'branch-secret',
      'content-type': 'image/jpeg',
      'x-cash-year': '2026',
      'x-cash-file-name': encodeURIComponent('1000056081.jpg'),
      'x-cash-branch': encodeURIComponent('Подменённый филиал')
    },
    body: Buffer.from('image'),
    ...overrides
  };
}

function authorize(token) {
  return token === 'branch-secret' ? { accessId: 'BRANCH:ЯМСКАЯ', branch: 'Ямская' } : null;
}

test('rejects unauthenticated upload without calling service', async () => {
  let calls = 0;
  const handler = createCashPhotoUploadHttpHandler({
    authorize,
    uploadService: { async upload() { calls += 1; } }
  });
  const res = responseRecorder();
  await handler(req({ headers: { 'content-type': 'image/jpeg' } }), res);
  assert.equal(res.code, 403);
  assert.equal(calls, 0);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('derives branch from opaque token and passes raw image to upload service', async () => {
  let received;
  const handler = createCashPhotoUploadHttpHandler({
    authorize,
    uploadService: {
      async upload(input) {
        received = input;
        return { statusCode: 200, body: { ok: true, photoId: 'PHOTO-1' } };
      }
    }
  });
  const res = responseRecorder();
  await handler(req(), res);
  assert.equal(res.code, 200);
  assert.equal(received.mimeType, 'image/jpeg');
  assert.equal(received.branch, 'Ямская');
  assert.equal(received.year, 2026);
  assert.equal(received.fileName, '1000056081.jpg');
  assert.deepEqual(received.imageBytes, Buffer.from('image'));
});

test('returns 202 safe pending response without leaking diagnostics', async () => {
  const handler = createCashPhotoUploadHttpHandler({
    authorize,
    uploadService: {
      async upload() {
        return {
          statusCode: 202,
          body: {
            ok: true,
            saved: true,
            pendingRecognition: true,
            message: 'Распознавание временно недоступно. Фото сохранено, повторно загружать его не нужно.'
          }
        };
      }
    }
  });
  const res = responseRecorder();
  await handler(req(), res);
  assert.equal(res.code, 202);
  assert.equal(res.payload.saved, true);
  assert.doesNotMatch(JSON.stringify(res.payload), /gemini|500|503|stack/i);
});

test('rejects non-POST methods', async () => {
  const handler = createCashPhotoUploadHttpHandler({ authorize, uploadService: { async upload() {} } });
  const res = responseRecorder();
  await handler(req({ method: 'GET' }), res);
  assert.equal(res.code, 405);
  assert.equal(res.headers.allow, 'POST');
});
