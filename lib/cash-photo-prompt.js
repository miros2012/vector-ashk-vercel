const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function buildOperationSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      date: { type: 'string', description: 'Дата в формате dd.MM.yyyy или пустая строка.' },
      description: { type: 'string', description: 'Описание точно по журналу.' },
      expense: { type: 'number', description: 'Положительная сумма расхода или 0.' },
      income: { type: 'number', description: 'Положительная сумма прихода или 0.' },
      balance: { type: 'number', description: 'Остаток после операции или -1.' },
      balanceReadable: { type: 'boolean' },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      needsReview: { type: 'boolean' },
      note: { type: 'string' }
    },
    required: [
      'date', 'description', 'expense', 'income', 'balance',
      'balanceReadable', 'confidence', 'needsReview', 'note'
    ]
  };
}

export function buildCashPhotoGeminiPayload({ imageBytes, mimeType, branch, year } = {}) {
  const normalizedMimeType = String(mimeType || '').toLowerCase().trim();
  if (!ALLOWED_MIME_TYPES.has(normalizedMimeType)) {
    throw new Error('Cash journal photo must be JPEG, PNG or WebP.');
  }
  if (!Buffer.isBuffer(imageBytes) || imageBytes.length === 0) {
    throw new Error('Cash journal photo bytes are required.');
  }

  const normalizedBranch = String(branch || '').trim();
  const normalizedYear = Number(year);
  if (!normalizedBranch) throw new Error('Cash journal branch is required.');
  if (!Number.isInteger(normalizedYear) || normalizedYear < 2020 || normalizedYear > 2100) {
    throw new Error('Cash journal year is invalid.');
  }

  const prompt = [
    'Ты распознаёшь рукописный кассовый журнал сети автошкол «Вектор».',
    `Филиал: ${normalizedBranch}. Год всех дат без года: ${normalizedYear}.`,
    '',
    'На странице таблица с колонками: Дата | Наименование | Расход | Приход | Остаток.',
    '',
    'Правила:',
    '1. Извлеки операции строго сверху вниз, одна денежная операция — один объект.',
    '2. Расход и приход возвращай положительными числами. Отсутствующая сумма = 0.',
    '3. Остаток — число, записанное после конкретной операции.',
    '4. Для КАЖДОЙ операции обязательно верни дату в формате dd.MM.yyyy. Если одна дата относится к нескольким строкам, повтори её.',
    '5. Не классифицируй статью ДДС и не исправляй смысл описания.',
    '6. Не выдумывай неразборчивые слова. Пиши [неразборчиво], ставь needsReview=true и поясняй в note.',
    '7. Если сомневаешься в дате, сумме, колонке, описании или остатке — needsReview=true.',
    '8. Проверь арифметику: предыдущий остаток - расход + приход = новый остаток. Если она не сходится, не меняй цифры, а укажи проблему в note.',
    '9. Не импортируй заголовки, начальный остаток как отдельную операцию, обрезанные строки соседней страницы и строки без денежной суммы.',
    '10. Если начальный остаток перед первой полной операцией можно вычислить, верни его в initialBalance, иначе -1.',
    '11. confidence — уверенность в правильности всей строки от 0 до 100.',
    '12. До извлечения операций отдельно посчитай все полностью видимые денежные строки страницы и верни visibleMoneyRowCount.',
    '13. visibleMoneyRowCount считает только строки с ненулевым расходом или приходом.',
    '14. Верни последний отчётливо видимый остаток страницы в finalBalance и укажи finalBalanceReadable.',
    '15. Сравни visibleMoneyRowCount с operations.length и укажи риск пропуска в pageNote, если они различаются.',
    '16. Проверь, что последняя распознанная операция приводит к finalBalance; если нет — укажи риск пропущенной строки в pageNote.',
    '',
    'Верни только структурированный результат по заданной JSON-схеме.'
  ].join('\n');

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      initialBalance: { type: 'number' },
      visibleMoneyRowCount: { type: 'integer', minimum: 0 },
      finalBalance: { type: 'number' },
      finalBalanceReadable: { type: 'boolean' },
      pageNote: { type: 'string' },
      operations: { type: 'array', items: buildOperationSchema() }
    },
    required: [
      'initialBalance', 'visibleMoneyRowCount', 'finalBalance',
      'finalBalanceReadable', 'pageNote', 'operations'
    ]
  };

  return {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { mimeType: normalizedMimeType, data: imageBytes.toString('base64') } }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: schema
    }
  };
}
