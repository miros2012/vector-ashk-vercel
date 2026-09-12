import test from 'node:test';
import assert from 'node:assert/strict';
import { createCashPhotoStore } from '../lib/cash-photo-store.js';

function makeClients() {
  const calls = [];
  const sheetRows = [];
  const drive = {
    files: {
      async create(args) {
        calls.push(['drive.create', args]);
        return { data: { id: 'drive-new', webViewLink: 'https://drive.google.com/file/d/drive-new/view' } };
      },
      async get(args) {
        calls.push(['drive.get', args]);
        return { data: { id: args.fileId, name: 'folder' } };
      }
    }
  };
  const sheets = {
    spreadsheets: {
      values: {
        async get(args) {
          calls.push(['sheets.get', args]);
          return { data: { values: sheetRows } };
        },
        async append(args) {
          calls.push(['sheets.append', args]);
          return { data: { updates: { updatedRange: "'Архив кассовых фото'!A302:N302" } } };
        },
        async update(args) {
          calls.push(['sheets.update', args]);
          return { data: {} };
        }
      }
    }
  };
  return { drive, sheets, calls, sheetRows };
}

test('findByHash returns archive identity and parses Drive file id from URL', async () => {
  const { drive, sheets, sheetRows } = makeClients();
  sheetRows.push([
    'PHOTO-old', '10.09.2026 13:44:25', 'Ямская', '2026', '1000056081.jpg',
    'https://drive.google.com/file/d/abc123/view', 'hash1', 'Ожидает распознавания', '', '', '', '', '', ''
  ]);
  const store = createCashPhotoStore({ drive, sheets, spreadsheetId: 'sheet', folderId: 'folder', now: () => new Date('2026-09-10T10:00:00Z') });
  const found = await store.findByHash('hash1');
  assert.deepEqual(found, {
    photoId: 'PHOTO-old', archiveRow: 2, fileId: 'abc123', branch: 'Ямская',
    photoUrl: 'https://drive.google.com/file/d/abc123/view', status: 'Ожидает распознавания', hash: 'hash1'
  });
});

test('findByHash resolves a legacy rich-text Drive hyperlink instead of trusting display text', async () => {
  const { drive, sheets, calls, sheetRows } = makeClients();
  sheetRows.push([
    'PHOTO-legacy', '', 'Ямская', '2026', '1000056081.jpg',
    'Открыть фото', 'legacy-hash', 'Ошибка распознавания', '', '', '', '', '', ''
  ]);
  sheets.spreadsheets.get = async (args) => {
    calls.push(['sheets.metadata.get', args]);
    return {
      data: {
        sheets: [{ data: [{ rowData: [{ values: [{
          hyperlink: 'https://drive.google.com/file/d/legacy-file-id/view?usp=drivesdk'
        }] }] }] }]
      }
    };
  };

  const store = createCashPhotoStore({ drive, sheets, spreadsheetId: 'sheet', folderId: 'folder' });
  const found = await store.findByHash('legacy-hash');
  assert.deepEqual(found, {
    photoId: 'PHOTO-legacy', archiveRow: 2, fileId: 'legacy-file-id', branch: 'Ямская',
    photoUrl: 'https://drive.google.com/file/d/legacy-file-id/view?usp=drivesdk',
    status: 'Ошибка распознавания', hash: 'legacy-hash'
  });
  assert.equal(calls.filter(([name]) => name === 'sheets.metadata.get').length, 1);
});

test('persistPhoto writes Drive file first then appends one archive row in uploaded state', async () => {
  const { drive, sheets, calls } = makeClients();
  const store = createCashPhotoStore({ drive, sheets, spreadsheetId: 'sheet', folderId: 'folder', now: () => new Date('2026-09-10T10:00:00Z') });
  const result = await store.persistPhoto({
    imageBytes: Buffer.from('image'), mimeType: 'image/jpeg', branch: 'Ямская', year: 2026,
    fileName: '1000056081.jpg', hash: '315df084abcdef'
  });

  assert.equal(calls[0][0], 'drive.create');
  assert.equal(calls[1][0], 'sheets.append');
  assert.equal(calls[1][1].requestBody.values[0][7], 'Загружено');
  assert.equal(calls[1][1].requestBody.values[0][6], '315df084abcdef');
  assert.equal(result.archiveRow, 302);
  assert.equal(result.fileId, 'drive-new');
  assert.match(result.photoId, /^PHOTO-20260910-.*-315df084$/);
});

test('separate OAuth writer owns new uploads while legacy reader remains available', async () => {
  const { drive, sheets, calls } = makeClients();
  const uploadDrive = { files: { async create(args) { calls.push(['oauth.create', args]); return { data: { id: 'user-owned-file' } }; } } };
  const store = createCashPhotoStore({ drive, uploadDrive, sheets, spreadsheetId: 'sheet', folderId: 'folder' });
  await store.persistPhoto({ imageBytes: Buffer.from('photo'), mimeType: 'image/png', branch: 'Ямская', year: 2026, fileName: 'photo.png', hash: 'abc' });
  assert.equal(calls[0][0], 'oauth.create');
  assert.equal(calls[0][1].supportsAllDrives, true);
  assert.equal(calls[1][0], 'sheets.append');
  assert.equal(calls.some(([name]) => name === 'drive.create'), false);
  await store.probe();
  assert.equal(calls.at(-1)[0], 'drive.get');
});

test('markRecognized updates only cash photo archive fields and never DDS', async () => {
  const { drive, sheets, calls } = makeClients();
  const store = createCashPhotoStore({ drive, sheets, spreadsheetId: 'sheet', folderId: 'folder' });
  await store.markRecognized({ photoId: 'PHOTO-1', archiveRow: 302 }, {
    model: 'google/gemini-3.8-flash',
    data: { pageNote: 'ok', operations: [{ needsReview: false }, { needsReview: true }] }
  });

  const update = calls.find((c) => c[0] === 'sheets.update')[1];
  assert.equal(update.range, "'Архив кассовых фото'!H302:N302");
  assert.equal(update.requestBody.values[0][0], 'Распознано — ожидает обработки');
  assert.equal(update.requestBody.values[0][1], 2);
  assert.equal(update.requestBody.values[0][2], 1);
  assert.equal(update.requestBody.values[0][4], 'google/gemini-3.8-flash');
  assert.ok(calls.every(([, args]) => !String(args.range || '').includes('ДДС')));
});

test('markPending stores safe state and diagnostics only in archive comment', async () => {
  const { drive, sheets, calls } = makeClients();
  const store = createCashPhotoStore({ drive, sheets, spreadsheetId: 'sheet', folderId: 'folder' });
  await store.markPending({ archiveRow: 302 }, {
    message: 'Распознавание временно недоступно. Фото сохранено.',
    diagnostics: ['provider HTTP 503 high demand']
  });
  const updates = calls.filter((c) => c[0] === 'sheets.update').map((c) => c[1]);
  assert.equal(updates[0].range, "'Архив кассовых фото'!H302");
  assert.equal(updates[0].requestBody.values[0][0], 'Ожидает распознавания');
  assert.equal(updates[1].range, "'Архив кассовых фото'!M302");
  assert.match(updates[1].requestBody.values[0][0], /503/);
});

test('probe is read-only and checks configured Drive folder', async () => {
  const { drive, sheets, calls } = makeClients();
  const store = createCashPhotoStore({ drive, sheets, spreadsheetId: 'sheet', folderId: 'folder' });
  const result = await store.probe();
  assert.equal(result.ok, true);
  assert.equal(calls[0][0], 'drive.get');
  assert.equal(calls[0][1].fileId, 'folder');
  assert.equal(calls.some((c) => c[0] === 'drive.create' || c[0] === 'sheets.append' || c[0] === 'sheets.update'), false);
});

test('listPending returns only retryable archive rows with enough metadata', async () => {
  const { drive, sheets, sheetRows } = makeClients();
  sheetRows.push(
    ['PHOTO-1', '', 'Ямская', '2026', 'one.jpg', 'https://drive.google.com/file/d/file1/view', 'h1', 'Ожидает распознавания'],
    ['PHOTO-2', '', 'Герцена', '2026', 'two.jpg', 'https://drive.google.com/file/d/file2/view', 'h2', 'Распознано — ожидает обработки'],
    ['PHOTO-3', '', 'Зарека', '2026', 'three.jpg', 'https://drive.google.com/file/d/file3/view', 'h3', 'Ожидает распознавания']
  );
  const store = createCashPhotoStore({ drive, sheets, spreadsheetId: 'sheet', folderId: 'folder' });
  const pending = await store.listPending(1);
  assert.deepEqual(pending, [{
    photoId: 'PHOTO-1', archiveRow: 2, fileId: 'file1', photoUrl: 'https://drive.google.com/file/d/file1/view',
    status: 'Ожидает распознавания', hash: 'h1', branch: 'Ямская', year: 2026, fileName: 'one.jpg'
  }]);
});

test('listPending resolves the legacy rich-text hyperlink for a specifically selected pending photo', async () => {
  const { drive, sheets, calls, sheetRows } = makeClients();
  sheetRows.push([
    'PHOTO-legacy', '', 'Ямская', '2026', '1000056081.jpg',
    'Открыть фото', 'legacy-hash', 'Ожидает распознавания'
  ]);
  sheets.spreadsheets.get = async (args) => {
    calls.push(['sheets.metadata.get', args]);
    return {
      data: {
        sheets: [{ data: [{ rowData: [{ values: [{
          hyperlink: 'https://drive.google.com/file/d/legacy-file-id/view?usp=drivesdk'
        }] }] }] }]
      }
    };
  };

  const store = createCashPhotoStore({ drive, sheets, spreadsheetId: 'sheet', folderId: 'folder' });
  const pending = await store.listPending(1, { branch: 'Ямская', photoId: 'PHOTO-legacy' });
  assert.deepEqual(pending, [{
    photoId: 'PHOTO-legacy', archiveRow: 2, fileId: 'legacy-file-id',
    photoUrl: 'https://drive.google.com/file/d/legacy-file-id/view?usp=drivesdk',
    status: 'Ожидает распознавания', hash: 'legacy-hash', branch: 'Ямская', year: 2026,
    fileName: '1000056081.jpg'
  }]);
  const metadataCall = calls.find(([name]) => name === 'sheets.metadata.get');
  assert.ok(metadataCall);
  assert.deepEqual(metadataCall[1].ranges, ["'Архив кассовых фото'!F2:F2"]);
});

test('listPending allows one explicitly selected failed legacy photo only for recovery', async () => {
  const { drive, sheets, calls, sheetRows } = makeClients();
  sheetRows.push(
    ['PHOTO-20260910-134422-315df084', '', 'Ямская', '2026', '1000056081.jpg', 'Открыть фото', 'target-hash', 'Ошибка распознавания'],
    ['PHOTO-other', '', 'Ямская', '2026', 'other.jpg', 'https://drive.google.com/file/d/other-file/view', 'other-hash', 'Ошибка распознавания']
  );
  sheets.spreadsheets.get = async (args) => {
    calls.push(['sheets.metadata.get', args]);
    return {
      data: {
        sheets: [{ data: [{ rowData: [{ values: [{
          hyperlink: 'https://drive.google.com/file/d/target-file/view?usp=drivesdk'
        }] }] }] }]
      }
    };
  };
  const store = createCashPhotoStore({ drive, sheets, spreadsheetId: 'sheet', folderId: 'folder' });

  assert.deepEqual(await store.listPending(1, {
    branch: 'Ямская',
    photoId: 'PHOTO-20260910-134422-315df084',
    allowFailed: true
  }), [{
    photoId: 'PHOTO-20260910-134422-315df084', archiveRow: 2, fileId: 'target-file',
    photoUrl: 'https://drive.google.com/file/d/target-file/view?usp=drivesdk',
    status: 'Ошибка распознавания', hash: 'target-hash', branch: 'Ямская', year: 2026,
    fileName: '1000056081.jpg'
  }]);
  assert.deepEqual(await store.listPending(1, {
    branch: 'Ямская',
    photoId: 'PHOTO-20260910-134422-315df084'
  }), []);
});

test('readPhoto downloads Drive bytes without writing anything', async () => {
  const { drive, sheets, calls } = makeClients();
  drive.files.get = async (args, options) => {
    calls.push(['drive.get', args, options]);
    return { data: new Uint8Array([1,2,3]).buffer, headers: { 'content-type': 'image/jpeg' } };
  };
  const store = createCashPhotoStore({ drive, sheets, spreadsheetId: 'sheet', folderId: 'folder' });
  const result = await store.readPhoto({ fileId: 'file1' });
  assert.deepEqual(result.imageBytes, Buffer.from([1,2,3]));
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(calls[0][1].alt, 'media');
  assert.equal(calls.some((c) => c[0] === 'drive.create' || c[0] === 'sheets.append' || c[0] === 'sheets.update'), false);
});
