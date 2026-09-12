import { createHash } from 'node:crypto';
import { CashPhotoRecognitionUnavailableError } from './cash-photo-recognizer.js';

export const MAX_CASH_PHOTO_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function validateInput({ imageBytes, mimeType, branch, year, fileName }) {
  if (!Buffer.isBuffer(imageBytes) || imageBytes.length === 0) {
    throw new Error('Фотография не получена.');
  }
  if (imageBytes.length > MAX_CASH_PHOTO_BYTES) {
    throw new Error('Файл слишком большой. Уменьшите размер изображения и повторите отправку.');
  }
  if (!ALLOWED_MIME_TYPES.has(String(mimeType || '').toLowerCase())) {
    throw new Error('Поддерживаются только JPEG, PNG or WebP.');
  }
  if (!String(branch || '').trim()) throw new Error('Не указан филиал.');
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear) || numericYear < 2020 || numericYear > 2100) {
    throw new Error('Некорректный год журнала.');
  }
  if (!String(fileName || '').trim()) throw new Error('Не указано имя файла.');
}

function isRecognizedStatus(status) {
  return String(status || '').trim().startsWith('Распознано');
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createCashPhotoUploadService({ store, recognize } = {}) {
  if (!store) throw new Error('Cash photo store is required');
  if (typeof recognize !== 'function') throw new Error('Cash photo recognizer is required');

  return {
    async upload(input = {}) {
      validateInput(input);
      const normalized = {
        ...input,
        mimeType: String(input.mimeType).toLowerCase(),
        branch: String(input.branch).trim(),
        year: Number(input.year),
        fileName: String(input.fileName).trim()
      };
      const hash = sha256Hex(normalized.imageBytes);
      const existing = await store.findByHash(hash);

      if (existing && String(existing.branch || '').trim() !== normalized.branch) {
        return { statusCode: 409, body: {
          ok: false, error: 'photo_branch_mismatch',
          message: 'Это фото уже сохранено с другим филиалом. Проверьте выбранный филиал; повторно сохранять фото не нужно.'
        } };
      }

      if (existing && isRecognizedStatus(existing.status)) {
        return {
          statusCode: 200,
          body: {
            ok: true,
            saved: true,
            alreadyStored: true,
            photoId: existing.photoId,
            message: 'Это фото уже было принято и распознано. Повторная загрузка не требуется.'
          }
        };
      }

      const photo = existing || await store.persistPhoto({ ...normalized, hash });
      await store.markRecognizing?.(photo);

      try {
        const recognition = await recognize(normalized);
        await store.markRecognized?.(photo, recognition);
        const operations = Array.isArray(recognition?.data?.operations)
          ? recognition.data.operations
          : [];
        return {
          statusCode: 200,
          body: {
            ok: true,
            saved: true,
            photoId: photo.photoId,
            rowsRecognized: operations.length,
            reviewCount: operations.filter((item) => item?.needsReview).length,
            pendingRecognition: false,
            message: 'Фото сохранено и распознано. Финансовые операции автоматически не классифицировались.'
          }
        };
      } catch (error) {
        if (error instanceof CashPhotoRecognitionUnavailableError || error?.retryable === true) {
          const publicMessage = error.publicMessage ||
            'Распознавание временно недоступно. Фото сохранено, повторно загружать его не нужно.';
          await store.markPending?.(photo, {
            message: publicMessage,
            diagnostics: Array.isArray(error.diagnostics) ? error.diagnostics : []
          });
          return {
            statusCode: 202,
            body: {
              ok: true,
              saved: true,
              photoId: photo.photoId,
              pendingRecognition: true,
              message: publicMessage
            }
          };
        }

        await store.markFailed?.(photo, {
          message: 'Распознавание не выполнено. Фото сохранено.',
          diagnostics: Array.isArray(error?.diagnostics) ? error.diagnostics : []
        });
        throw error;
      }
    }
  };
}
