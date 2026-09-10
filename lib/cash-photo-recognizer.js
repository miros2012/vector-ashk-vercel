const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class CashPhotoRecognitionUnavailableError extends Error {
  constructor({ diagnostics = [] } = {}) {
    super('Cash photo recognition temporarily unavailable');
    this.name = 'CashPhotoRecognitionUnavailableError';
    this.retryable = true;
    this.publicMessage = 'Распознавание временно недоступно. Фото сохранено, повторно загружать его не нужно.';
    this.diagnostics = diagnostics;
  }
}

function extractApiMessage(body, raw = '') {
  return String(body?.error?.message || body?.message || raw || '').slice(0, 1200);
}

function extractContent(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === 'string' ? part : (part?.text || ''))
      .join('')
      .trim();
  }
  return '';
}

function parseStructuredBody(body) {
  const text = extractContent(body);
  if (!text) throw new Error('AI Gateway returned an empty response');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('AI Gateway returned invalid JSON');
  }
  if (!data || !Array.isArray(data.operations)) {
    throw new Error('AI Gateway response is missing operations array');
  }
  return data;
}

function delayMs(baseDelayMs, attempt, randomImpl) {
  const exponential = baseDelayMs * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(exponential * 0.25 * Math.max(0, Math.min(1, Number(randomImpl()) || 0)));
  return exponential + jitter;
}

export async function recognizeWithFallback({
  token,
  payload,
  models,
  fetchImpl = fetch,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  randomImpl = Math.random,
  maxAttemptsPerModel = 3,
  baseDelayMs = 1000,
  gatewayUrl = 'https://ai-gateway.vercel.sh/v1/chat/completions'
} = {}) {
  if (!token) throw new Error('AI Gateway authentication token is missing');
  if (!Array.isArray(models) || models.length === 0) throw new Error('No recognition models configured');

  const diagnostics = [];

  for (const model of models) {
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt += 1) {
      let res;
      try {
        res = await fetchImpl(gatewayUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ ...payload, model })
        });
      } catch (error) {
        diagnostics.push(`${model}: network error: ${String(error?.message || error)} (attempt ${attempt}/${maxAttemptsPerModel})`);
        if (attempt < maxAttemptsPerModel) {
          await sleepImpl(delayMs(baseDelayMs, attempt, randomImpl));
          continue;
        }
        break;
      }

      let body = {};
      let raw = '';
      try {
        body = await res.json();
      } catch {
        try { raw = await res.text(); } catch { raw = ''; }
      }

      if (res.ok) {
        return {
          model,
          data: parseStructuredBody(body),
          diagnostics
        };
      }

      const message = extractApiMessage(body, raw);
      diagnostics.push(`${model}: HTTP ${res.status}: ${message} (attempt ${attempt}/${maxAttemptsPerModel})`);

      if (res.status === 404) break;

      if (!TRANSIENT_STATUS.has(res.status)) {
        const error = new Error(`AI Gateway error ${res.status}: ${message}`);
        error.status = res.status;
        error.retryable = false;
        error.diagnostics = diagnostics;
        throw error;
      }

      if (attempt < maxAttemptsPerModel) {
        await sleepImpl(delayMs(baseDelayMs, attempt, randomImpl));
        continue;
      }
      break;
    }
  }

  throw new CashPhotoRecognitionUnavailableError({ diagnostics });
}
