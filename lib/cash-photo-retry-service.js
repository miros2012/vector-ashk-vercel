import { CashPhotoRecognitionUnavailableError } from './cash-photo-recognizer.js';

export function createCashPhotoRetryService({ store, recognize } = {}) {
  if (!store?.listPending || !store?.readPhoto) throw new Error('Cash photo store with retry support is required');
  if (typeof recognize !== 'function') throw new Error('Cash photo recognizer is required');

  return {
    async retryPending(limit = 3) {
      const photos = await store.listPending(limit);
      const result = { attempted: 0, recognized: 0, stillPending: 0, failed: 0 };

      for (const photo of photos) {
        result.attempted += 1;
        try {
          const downloaded = await store.readPhoto(photo);
          await store.markRecognizing?.(photo);
          const recognition = await recognize({
            imageBytes: downloaded.imageBytes,
            mimeType: downloaded.mimeType,
            branch: photo.branch,
            year: photo.year,
            fileName: photo.fileName
          });
          await store.markRecognized?.(photo, recognition);
          result.recognized += 1;
        } catch (error) {
          if (error instanceof CashPhotoRecognitionUnavailableError || error?.retryable === true) {
            await store.markPending?.(photo, {
              message: error.publicMessage || 'Распознавание временно недоступно. Фото сохранено.',
              diagnostics: Array.isArray(error.diagnostics) ? error.diagnostics : []
            });
            result.stillPending += 1;
            continue;
          }
          await store.markFailed?.(photo, {
            message: 'Автоматическое распознавание не выполнено. Фото сохранено.',
            diagnostics: Array.isArray(error?.diagnostics) ? error.diagnostics : [String(error?.message || error)]
          });
          result.failed += 1;
        }
      }

      return result;
    }
  };
}
