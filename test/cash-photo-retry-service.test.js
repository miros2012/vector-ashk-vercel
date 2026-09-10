import test from 'node:test';
import assert from 'node:assert/strict';
import { CashPhotoRecognitionUnavailableError } from '../lib/cash-photo-recognizer.js';
import { createCashPhotoRetryService } from '../lib/cash-photo-retry-service.js';

function pendingPhoto() {
  return { photoId: 'PHOTO-1', archiveRow: 302, fileId: 'file1', branch: 'Ямская', year: 2026, fileName: 'one.jpg' };
}

test('retries only pending photos and marks successful recognition without DDS writes', async () => {
  const sequence = [];
  const store = {
    async listPending(limit) { sequence.push(['list', limit]); return [pendingPhoto()]; },
    async readPhoto() { sequence.push(['read']); return { imageBytes: Buffer.from('img'), mimeType: 'image/jpeg' }; },
    async markRecognizing() { sequence.push(['recognizing']); },
    async markRecognized(_photo, result) { sequence.push(['recognized']); assert.equal(result.data.operations.length, 1); }
  };
  const service = createCashPhotoRetryService({
    store,
    recognize: async (input) => {
      sequence.push(['recognize']);
      assert.equal(input.branch, 'Ямская');
      assert.deepEqual(input.imageBytes, Buffer.from('img'));
      return { model: 'google/gemini-3.8-flash', data: { operations: [{}] } };
    }
  });
  const result = await service.retryPending(2);
  assert.deepEqual(result, { attempted: 1, recognized: 1, stillPending: 0, failed: 0 });
  assert.deepEqual(sequence.map((x) => x[0]), ['list','read','recognizing','recognize','recognized']);
});

test('transient failure remains pending and does not abort other items', async () => {
  const photos = [pendingPhoto(), { ...pendingPhoto(), photoId: 'PHOTO-2', archiveRow: 303, fileId: 'file2' }];
  let recognitionCalls = 0;
  let pendingMarks = 0;
  let recognizedMarks = 0;
  const service = createCashPhotoRetryService({
    store: {
      async listPending() { return photos; },
      async readPhoto() { return { imageBytes: Buffer.from('img'), mimeType: 'image/jpeg' }; },
      async markRecognizing() {},
      async markPending() { pendingMarks += 1; },
      async markRecognized() { recognizedMarks += 1; }
    },
    recognize: async () => {
      recognitionCalls += 1;
      if (recognitionCalls === 1) throw new CashPhotoRecognitionUnavailableError({ diagnostics: ['503'] });
      return { model: 'model', data: { operations: [] } };
    }
  });
  const result = await service.retryPending(5);
  assert.deepEqual(result, { attempted: 2, recognized: 1, stillPending: 1, failed: 0 });
  assert.equal(pendingMarks, 1);
  assert.equal(recognizedMarks, 1);
});
