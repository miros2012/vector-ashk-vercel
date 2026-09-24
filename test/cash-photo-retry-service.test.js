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


test('concurrent recovery backfills one recognized journal and reconciles draft review queue', async () => {
  let backfillLimit = 0;
  let reconciliationLimit = 0;
  const store = {
    async listPending() { return []; },
    async readPhoto() { throw new Error('not used'); },
    async syncRecognizedDraftBacklog(limit) {
      backfillLimit = limit;
      return { attempted: 2, synced: 2, skipped: 0, failed: 0 };
    },
    async reconcileDraftBacklog(limit) {
      reconciliationLimit = limit;
      return {
        scanned: 4, promoted: 2, recovered: 1, duplicates: 1, unresolved: 0,
        transferredOperations: 2, createdDDSRows: 2
      };
    }
  };
  const service = createCashPhotoRetryService({
    store,
    recognize: async () => ({ model: 'model', data: { operations: [] } })
  });
  const result = await service.retryPendingConcurrent(3, {});
  assert.deepEqual(result, {
    attempted: 0, recognized: 0, stillPending: 0, failed: 0,
    draftBackfill: { attempted: 2, synced: 2, skipped: 0, failed: 0 },
    draftReconciliation: {
      scanned: 4, promoted: 2, recovered: 1, duplicates: 1, unresolved: 0,
      transferredOperations: 2, createdDDSRows: 2
    }
  });
  assert.equal(backfillLimit, 1);
  assert.equal(reconciliationLimit, 20);
});


test('concurrent recovery can skip financial draft reconciliation for production smoke', async () => {
  let reconciliations = 0;
  const store = {
    async listPending() { return []; },
    async readPhoto() { throw new Error('not used'); },
    async syncRecognizedDraftBacklog() {
      return { attempted: 0, synced: 0, skipped: 0, failed: 0 };
    },
    async reconcileDraftBacklog() { reconciliations += 1; return {}; }
  };
  const service = createCashPhotoRetryService({
    store,
    recognize: async () => ({ model: 'model', data: { operations: [] } })
  });
  const result = await service.retryPendingConcurrent(3, {}, { reconcileDraft: false });
  assert.equal(reconciliations, 0);
  assert.equal(result.draftReconciliation, undefined);
});
