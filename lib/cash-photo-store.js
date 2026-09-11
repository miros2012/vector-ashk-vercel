import { Readable } from 'node:stream';

const ARCHIVE_SHEET = 'Архив кассовых фото';

function safeFileName(value) {
  return String(value || 'photo.jpg')
    .replace(/[\\/:*?"<>|#%{}[\]]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'photo.jpg';
}

function timestampParts(date) {
  const iso = date.toISOString();
  return {
    day: iso.slice(0, 10).replace(/-/g, ''),
    time: iso.slice(11, 19).replace(/:/g, '')
  };
}

function driveFileIdFromUrl(url) {
  const match = String(url || '').match(/\/d\/([^/]+)/);
  return match ? match[1] : '';
}

function archiveRowFromUpdatedRange(updatedRange) {
  const match = String(updatedRange || '').match(/![A-Z]+(\d+)(?::[A-Z]+\d+)?$/i);
  return match ? Number(match[1]) : 0;
}

function requireRow(photo) {
  const row = Number(photo?.archiveRow);
  if (!Number.isInteger(row) || row < 2) throw new Error('Cash photo archive row is missing');
  return row;
}

function diagnosticsText(message, diagnostics) {
  const tech = Array.isArray(diagnostics) && diagnostics.length
    ? `\n[TECH] ${diagnostics.join(' | ')}`
    : '';
  return `${String(message || '').trim()}${tech}`.slice(0, 45000);
}

export function createCashPhotoStore({
  drive,
  uploadDrive = drive,
  sheets,
  spreadsheetId,
  folderId,
  now = () => new Date()
} = {}) {
  if (!drive?.files) throw new Error('Google Drive client is required');
  if (!sheets?.spreadsheets?.values) throw new Error('Google Sheets client is required');
  if (!spreadsheetId) throw new Error('Spreadsheet id is required');
  if (!folderId) throw new Error('Cash photo folder id is required');

  const values = sheets.spreadsheets.values;

  async function updateRange(range, rowValues) {
    await values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [rowValues] }
    });
  }

  async function resolvePhotoLocation(displayValue, archiveRow) {
    const displayedUrl = String(displayValue || '').trim();
    const directFileId = driveFileIdFromUrl(displayedUrl);
    if (directFileId) return { photoUrl: displayedUrl, fileId: directFileId };
    if (typeof sheets.spreadsheets.get !== 'function') {
      return { photoUrl: displayedUrl, fileId: '' };
    }

    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [`'${ARCHIVE_SHEET}'!F${archiveRow}:F${archiveRow}`],
      includeGridData: true,
      fields: 'sheets(data(rowData(values(hyperlink))))'
    });
    const hyperlink = String(
      response?.data?.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.hyperlink || ''
    ).trim();
    const fileId = driveFileIdFromUrl(hyperlink);
    return fileId
      ? { photoUrl: hyperlink, fileId }
      : { photoUrl: displayedUrl, fileId: '' };
  }

  return {
    async findByHash(hash) {
      const response = await values.get({
        spreadsheetId,
        range: `'${ARCHIVE_SHEET}'!A2:N`
      });
      const rows = response?.data?.values || [];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] || [];
        if (String(row[6] || '').trim() !== String(hash || '').trim()) continue;
        const archiveRow = index + 2;
        const { photoUrl, fileId } = await resolvePhotoLocation(row[5], archiveRow);
        return {
          photoId: String(row[0] || '').trim(),
          archiveRow,
          fileId,
          photoUrl,
          status: String(row[7] || '').trim(),
          hash: String(row[6] || '').trim()
        };
      }
      return null;
    },

    async persistPhoto({ imageBytes, mimeType, branch, year, fileName, hash }) {
      const date = now();
      const stamp = timestampParts(date);
      const photoId = `PHOTO-${stamp.day}-${stamp.time}-${String(hash || '').slice(0, 8)}`;
      const storedName = `${safeFileName(branch)}_${stamp.day}_${stamp.time}_${safeFileName(fileName)}`;

      const created = await uploadDrive.files.create({
        requestBody: { name: storedName, parents: [folderId] },
        media: { mimeType, body: Readable.from(imageBytes) },
        fields: 'id,webViewLink',
        supportsAllDrives: true
      });
      const fileId = String(created?.data?.id || '').trim();
      if (!fileId) throw new Error('Google Drive did not return a file id');
      const photoUrl = String(created?.data?.webViewLink || `https://drive.google.com/file/d/${fileId}/view`);

      const appended = await values.append({
        spreadsheetId,
        range: `'${ARCHIVE_SHEET}'!A:N`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [[
            photoId,
            date.toISOString(),
            String(branch || '').trim(),
            Number(year),
            String(fileName || '').trim(),
            photoUrl,
            String(hash || '').trim(),
            'Загружено',
            '', '', '', '', '', ''
          ]]
        }
      });
      const archiveRow = archiveRowFromUpdatedRange(appended?.data?.updates?.updatedRange);
      if (!archiveRow) throw new Error('Google Sheets did not return the archive row');

      return { photoId, archiveRow, fileId, photoUrl, hash: String(hash || '').trim(), status: 'Загружено' };
    },

    async markRecognizing(photo) {
      const row = requireRow(photo);
      await updateRange(`'${ARCHIVE_SHEET}'!H${row}`, ['Распознавание']);
    },

    async markRecognized(photo, result) {
      const row = requireRow(photo);
      const operations = Array.isArray(result?.data?.operations) ? result.data.operations : [];
      const reviewCount = operations.filter((operation) => operation?.needsReview).length;
      await updateRange(`'${ARCHIVE_SHEET}'!H${row}:N${row}`, [
        'Распознано — ожидает обработки',
        operations.length,
        reviewCount,
        '',
        String(result?.model || ''),
        String(result?.data?.pageNote || '').slice(0, 45000),
        JSON.stringify(result?.data || {}).slice(0, 45000)
      ]);
    },

    async markPending(photo, { message, diagnostics } = {}) {
      const row = requireRow(photo);
      await updateRange(`'${ARCHIVE_SHEET}'!H${row}`, ['Ожидает распознавания']);
      await updateRange(`'${ARCHIVE_SHEET}'!M${row}`, [diagnosticsText(message, diagnostics)]);
    },

    async markFailed(photo, { message, diagnostics } = {}) {
      const row = requireRow(photo);
      await updateRange(`'${ARCHIVE_SHEET}'!H${row}`, ['Ошибка распознавания']);
      await updateRange(`'${ARCHIVE_SHEET}'!M${row}`, [diagnosticsText(message, diagnostics)]);
    },

    async listPending(limit = 5, filters = {}) {
      const response = await values.get({
        spreadsheetId,
        range: `'${ARCHIVE_SHEET}'!A2:N`
      });
      const rows = response?.data?.values || [];
      const branchFilter = String(filters?.branch || '').trim();
      const photoIdFilter = String(filters?.photoId || '').trim();
      const allowFailed = filters?.allowFailed === true;
      const pending = [];
      for (let index = 0; index < rows.length && pending.length < limit; index += 1) {
        const row = rows[index] || [];
        const status = String(row[7] || '').trim();
        const photoId = String(row[0] || '').trim();
        const explicitlySelectedFailed = allowFailed
          && Boolean(photoIdFilter)
          && photoId === photoIdFilter
          && status === 'Ошибка распознавания';
        if (status !== 'Ожидает распознавания' && !explicitlySelectedFailed) continue;
        const branch = String(row[2] || '').trim();
        if (branchFilter && branch !== branchFilter) continue;
        if (photoIdFilter && photoId !== photoIdFilter) continue;
        const archiveRow = index + 2;
        const { photoUrl, fileId } = await resolvePhotoLocation(row[5], archiveRow);
        if (!fileId) continue;
        pending.push({
          photoId,
          archiveRow,
          fileId,
          photoUrl,
          status,
          hash: String(row[6] || '').trim(),
          branch,
          year: Number(row[3]),
          fileName: String(row[4] || '').trim()
        });
      }
      return pending;
    },

    async readPhoto(photo) {
      const fileId = String(photo?.fileId || '').trim();
      if (!fileId) throw new Error('Cash photo Drive file id is missing');
      const response = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' }
      );
      return {
        imageBytes: Buffer.from(response?.data || []),
        mimeType: String(response?.headers?.['content-type'] || 'image/jpeg').split(';')[0].trim().toLowerCase()
      };
    },

    async probe() {
      const response = await drive.files.get({
        fileId: folderId,
        fields: 'id,name,capabilities(canAddChildren)',
        supportsAllDrives: true
      });
      return {
        ok: true,
        canAddChildren: Boolean(response?.data?.capabilities?.canAddChildren)
      };
    }
  };
}
