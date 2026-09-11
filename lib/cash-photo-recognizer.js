const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
export const DEFAULT_CASH_PHOTO_MODELS = Object.freeze(['gemini-3.8-flash', 'gemini-3.5-flash']);
const PUBLIC_MESSAGE = 'Распознавание временно недоступно. Фото сохранено, повторно загружать его не нужно.';

export class CashPhotoRecognitionUnavailableError extends Error {
  constructor({ diagnostics = [] } = {}) {
    super('Cash photo recognition temporarily unavailable');
    this.name = 'CashPhotoRecognitionUnavailableError';
    this.retryable = true;
    this.publicMessage = PUBLIC_MESSAGE;
    this.diagnostics = diagnostics;
  }
}

function permanentFailure(reason, status = 0, diagnostics = []) {
  const error = new Error(`Cash photo recognition failed: ${reason}`);
  error.name = 'CashPhotoRecognitionError';
  error.status = status;
  error.retryable = false;
  error.publicMessage = PUBLIC_MESSAGE;
  error.diagnostics = [...diagnostics, reason];
  return error;
}

function validModels(models) {
  return Array.isArray(models) && models.length > 0 && models.length <= 2
    && models.every(model => typeof model === 'string' && /^gemini-[a-z0-9.-]+$/.test(model));
}

// The timer covers both the response headers and reading its body. Never return
// upstream error bodies or exceptions: providers/transports can echo credentials.
async function requestJson(url, { apiKey, payload, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      redirect: 'error',
      signal: controller.signal
    });
    if (!response.ok) {
      controller.abort(); // Release an unread error body before clearing its timer.
      return { status: response.status, ok: false };
    }
    try {
      return { status: response.status, ok: true, body: await response.json() };
    } catch {
      return { status: response.status, ok: false, reason: controller.signal.aborted ? 'TIMEOUT' : 'INVALID_RESPONSE' };
    }
  } catch {
    return { status: 0, ok: false, reason: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR' };
  } finally {
    clearTimeout(timer);
  }
}

function parseStructuredBody(body, apiKey) {
  const candidate = body?.candidates?.[0];
  if (candidate?.finishReason !== 'STOP') throw permanentFailure('INCOMPLETE_RESPONSE');
  const parts = candidate?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.filter(part => !part?.thought && typeof part?.text === 'string').map(part => part.text).join('').trim()
    : '';
  if (!text || text.includes(apiKey)) throw permanentFailure('INVALID_RESPONSE');
  let data;
  try { data = JSON.parse(text); } catch { throw permanentFailure('INVALID_JSON'); }
  if (!data || !Array.isArray(data.operations)) throw permanentFailure('MISSING_OPERATIONS');
  return data;
}

function delayMs(baseDelayMs, attempt, randomImpl) {
  const exponential = baseDelayMs * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(exponential * 0.25 * Math.max(0, Math.min(1, Number(randomImpl()) || 0)));
  return exponential + jitter;
}

export async function recognizeWithFallback({
  apiKey = process.env.GEMINI_API_KEY,
  payload,
  models = DEFAULT_CASH_PHOTO_MODELS,
  fetchImpl = fetch,
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
  randomImpl = Math.random,
  now = Date.now,
  maxAttemptsPerModel = 2,
  baseDelayMs = 750,
  requestTimeoutMs = 20000,
  totalTimeoutMs = 40000
} = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new CashPhotoRecognitionUnavailableError({ diagnostics: ['GEMINI_KEY_MISSING'] });
  if (!validModels(models) || !Number.isInteger(maxAttemptsPerModel) || maxAttemptsPerModel < 1 || maxAttemptsPerModel > 3
      || !Number.isFinite(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > 1000
      || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > 20000
      || !Number.isFinite(totalTimeoutMs) || totalTimeoutMs <= 0 || totalTimeoutMs > 40000) {
    throw permanentFailure('INVALID_CONFIGURATION');
  }
  const deadline = now() + totalTimeoutMs;
  const diagnostics = [];
  modelLoop: for (const model of models) {
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) break modelLoop;
      const result = await requestJson(`${GEMINI_MODELS_URL}/${model}:generateContent`, {
        apiKey: key, payload, fetchImpl, timeoutMs: Math.min(requestTimeoutMs, remaining)
      });
      if (result.ok) return { model, data: parseStructuredBody(result.body, key), diagnostics };
      diagnostics.push(`${model}: ${result.reason || `HTTP ${result.status}`} (attempt ${attempt}/${maxAttemptsPerModel})`);
      if (result.reason === 'INVALID_RESPONSE') throw permanentFailure('INVALID_RESPONSE', result.status, diagnostics);
      if (result.status === 404) break; // A removed model may still have a supported fallback.
      if (result.status && !TRANSIENT_STATUS.has(result.status) && !result.reason) {
        throw permanentFailure(`HTTP_${result.status}`, result.status, diagnostics);
      }
      if (attempt < maxAttemptsPerModel) {
        const delay = delayMs(baseDelayMs, attempt, randomImpl);
        if (now() + delay >= deadline) break modelLoop;
        await sleepImpl(delay);
      }
    }
  }
  throw new CashPhotoRecognitionUnavailableError({ diagnostics });
}

// Read-only model metadata smoke: no generation, photo data, tokens, or raw bodies.
export async function probeGeminiModels({
  apiKey = process.env.GEMINI_API_KEY,
  models = DEFAULT_CASH_PHOTO_MODELS,
  fetchImpl = fetch
} = {}) {
  const key = String(apiKey || '').trim();
  const base = { ok: false, apiKeyConfigured: Boolean(key), models: [] };
  if (!key) return { ...base, reason: 'GEMINI_KEY_MISSING' };
  if (!validModels(models)) return { ...base, reason: 'INVALID_CONFIGURATION' };
  for (const model of models) {
    const result = await requestJson(`${GEMINI_MODELS_URL}/${model}`, { apiKey: key, fetchImpl, timeoutMs: 5000 });
    if (!result.ok) return { ...base, reason: result.reason || `HTTP_${result.status}`, upstreamStatus: result.status };
    if (result.body?.name !== `models/${model}` || !result.body?.supportedGenerationMethods?.includes('generateContent')) {
      return { ...base, reason: 'MODEL_UNSUPPORTED' };
    }
  }
  return { ok: true, apiKeyConfigured: true, models: [...models] };
}
