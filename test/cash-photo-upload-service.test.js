import test from 'node:test';
import assert from 'node:assert/strict';
import { CashPhotoRecognitionUnavailableError } from '../lib/cash-photo-recognizer.js';
import { createCashPhotoUploadService, MAX_CASH_PHOTO_BYTES } from '../lib/cash-photo-upload-service.js';

function validInput(overrides = {}) {
  return {
    imageBytes: Buffer.from('cash-photo'),
    mimeType: 'image/jpeg',
    branch: 'Ямская',
    year: 2026,
    fileName: '1000056081.jpg',
    ...overrides
  };
}

test('persists image before starting recognition and marks recognized without DDS writes', async () => {
  const sequence = [];
  const store = {
    async findByHash() { sequence.push('find'); return null; },
    async persistPhoto(input) { sequence.push('persist'); return { photoId: 'PHOTO-1', archiveRow: 301, fileId: 'drive-1', ...input }; },
    async markRecognizing() { sequence.push('recognizing'); },
    async markRecognized(_photo, result) { sequence.push('recognized'); assert.equal(result.data.operations.length, 1); }
  };
  const service = createCashPhotoUploadService({
    store,
    recognize: async () => {
      sequence.push('recognize');
      assert.ok(sequence.indexOf('persist') < sequence.indexOf('recognize'));
      return { model: 'google/gemini-3.8-flash', data: { operations: [{ needsReview: false }] }, diagnostics: [] };
    }
  });

  const result = await service.upload(validInput());

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.photoId, 'PHOTO-1');
  assert.equal(result.body.rowsRecognized, 1);
  assert.deepEqual(sequence, ['find', 'persist', 'recognizing', 'recognize', 'recognized']);
  assert.equal('ddsRows' in result.body, false);
});

test('transient recognition outage keeps saved photo pending and returns safe 202', async () => {
  let pending;
  const store = {
    async findByHash() { return null; },
    async persistPhoto() { return { photoId: 'PHOTO-2', archiveRow: 302, fileId: 'drive-2' }; },
    async markRecognizing() {},
    async markPending(_photo, details) { pending = details; }
  };
  const service = createCashPhotoUploadService({
    store,
    recognize: async () => { throw new CashPhotoRecognitionUnavailableError({ diagnostics: ['gemini: HTTP 500 secret-debug'] }); }
  });

  const result = await service.upload(validInput());

  assert.equal(result.statusCode, 202);
  assert.equal(result.body.saved, true);
  assert.equal(result.body.pendingRecognition, true);
  assert.match(result.body.message, /повторно загружать.*не нужно/i);
  assert.doesNotMatch(JSON.stringify(result.body), /gemini|500|secret-debug/i);
  assert.match(pending.diagnostics.join('\n'), /500/);
});

test('recognized duplicate is idempotent and does not store or recognize again', async () => {
  let persisted = 0;
  let recognized = 0;
  const service = createCashPhotoUploadService({
    store: {
      async findByHash() { return { photoId: 'PHOTO-old', status: 'Распознано — ожидает обработки' }; },
      async persistPhoto() { persisted += 1; }
    },
    recognize: async () => { recognized += 1; }
  });

  const result = await service.upload(validInput());

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.alreadyStored, true);
  assert.equal(result.body.photoId, 'PHOTO-old');
  assert.equal(persisted, 0);
  assert.equal(recognized, 0);
});

test('storage failure stops before recognition', async () => {
  let recognized = 0;
  const service = createCashPhotoUploadService({
    store: {
      async findByHash() { return null; },
      async persistPhoto() { throw new Error('drive unavailable'); }
    },
    recognize: async () => { recognized += 1; }
  });

  await assert.rejects(service.upload(validInput()), /drive unavailable/);
  assert.equal(recognized, 0);
});

test('rejects unsupported or oversized uploads before storage', async () => {
  let storeCalls = 0;
  const service = createCashPhotoUploadService({
    store: {
      async findByHash() { storeCalls += 1; return null; },
      async persistPhoto() { storeCalls += 1; }
    },
    recognize: async () => ({ data: { operations: [] } })
  });

  await assert.rejects(service.upload(validInput({ mimeType: 'application/pdf' })), /JPEG, PNG or WebP/);
  await assert.rejects(service.upload(validInput({ imageBytes: Buffer.alloc(MAX_CASH_PHOTO_BYTES + 1) })), /слишком большой/i);
  assert.equal(storeCalls, 0);
});
