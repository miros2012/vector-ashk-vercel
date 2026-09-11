import test from 'node:test';
import assert from 'node:assert/strict';
import { createCashPhotoOneTimeRecoveryService } from '../lib/cash-photo-one-time-recovery-service.js';

const target = {
  photoId: 'PHOTO-20260910-134422-315df084',
  hash: '315df084b00348e486a2fcfa358d997cf58684c00c98e38a01fa0c157ff12c28',
  branch: 'Ямская',
  year: 2026,
  fileName: '1000056081.jpg'
};

test('one-time recovery reads only the approved photo and stores recognition only in the photo archive', async () => {
  const calls = [];
  const photo = {
    photoId: target.photoId,
    hash: target.hash,
    archiveRow: 301,
    fileId: '1PsGTZVmi1aD_xiYbOnLHezSZK1tYiBhA',
    status: 'Ошибка распознавания'
  };
  const store = {
    async findByHash(hash) { calls.push(['findByHash', hash]); return photo; },
    async readPhoto(value) { calls.push(['readPhoto', value.photoId]); return { imageBytes: Buffer.from('image'), mimeType: 'image/jpeg' }; },
    async markRecognizing(value) { calls.push(['markRecognizing', value.photoId]); },
    async markRecognized(value, result) { calls.push(['markRecognized', value.photoId, result.model]); }
  };
  const recognize = async (input) => {
    calls.push(['recognize', input.branch, input.year, input.fileName]);
    return {
      model: 'google/gemini-3.8-flash',
      data: { pageNote: 'ok', operations: [{ needsReview: false }, { needsReview: true }] }
    };
  };

  const service = createCashPhotoOneTimeRecoveryService({ store, recognize, target });
  const result = await service.recover();

  assert.deepEqual(result, {
    status: 'recognized',
    photoId: target.photoId,
    model: 'google/gemini-3.8-flash',
    operationCount: 2,
    reviewCount: 1
  });
  assert.deepEqual(calls, [
    ['findByHash', target.hash],
    ['readPhoto', target.photoId],
    ['markRecognizing', target.photoId],
    ['recognize', 'Ямская', 2026, '1000056081.jpg'],
    ['markRecognized', target.photoId, 'google/gemini-3.8-flash']
  ]);
});

test('one-time recovery is idempotent after the approved photo is already recognized', async () => {
  let readCalls = 0;
  const store = {
    async findByHash() {
      return { photoId: target.photoId, hash: target.hash, status: 'Распознано — ожидает обработки' };
    },
    async readPhoto() { readCalls += 1; throw new Error('must not read'); }
  };
  const service = createCashPhotoOneTimeRecoveryService({
    store,
    recognize: async () => { throw new Error('must not recognize'); },
    target
  });

  assert.deepEqual(await service.recover(), { status: 'already_recognized', photoId: target.photoId });
  assert.equal(readCalls, 0);
});

test('one-time recovery fails closed if hash resolves to any other photo', async () => {
  const store = {
    async findByHash() { return { photoId: 'PHOTO-other', hash: target.hash, status: 'Ошибка распознавания' }; },
    async readPhoto() { throw new Error('must not read'); }
  };
  const service = createCashPhotoOneTimeRecoveryService({ store, recognize: async () => ({}), target });
  await assert.rejects(() => service.recover(), /approved cash photo not found/i);
});
