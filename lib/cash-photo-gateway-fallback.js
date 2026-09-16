const MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models';
const CHAT_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const PREFERRED_MODELS = Object.freeze([
  'openai/gpt-5.6-luna',
  'anthropic/claude-sonnet-5'
]);
const RETRYABLE_GATEWAY_STATUS = new Set([400, 403, 404, 408, 422, 429, 500, 502, 503, 504]);

function retryableError(diagnostics = []) {
  const error = new Error('Cash photo AI Gateway recognition temporarily unavailable');
  error.name = 'CashPhotoGatewayUnavailableError';
  error.retryable = true;
  error.publicMessage = 'Распознавание временно недоступно. Фото сохранено, повторно загружать его не нужно.';
  error.diagnostics = diagnostics;
  return error;
}

function permanentError(reason, status = 0, diagnostics = []) {
  const error = new Error(`Cash photo AI Gateway recognition failed: ${reason}`);
  error.name = 'CashPhotoGatewayRecognitionError';
  error.retryable = false;
  error.status = status;
  error.diagnostics = [...diagnostics, reason];
  return error;
}

function boundedToken(value) {
  const token = String(value || '').trim();
  if (!token || token.length > 16_000) throw retryableError(['gateway token unavailable']);
  return token;
}

function payloadParts(payload) {
  const parts = payload?.contents?.[0]?.parts;
  const prompt = Array.isArray(parts)
    ? String(parts.find(part => typeof part?.text === 'string')?.text || '').trim()
    : '';
  const inlineData = Array.isArray(parts)
    ? parts.find(part => part?.inlineData?.data)?.inlineData
    : null;
  const mimeType = String(inlineData?.mimeType || '').trim().toLowerCase();
  const data = String(inlineData?.data || '').trim();
  const schema = payload?.generationConfig?.responseJsonSchema;

  if (!prompt || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) || !data || !schema) {
    throw permanentError('INVALID_PAYLOAD');
  }
  return { prompt, mimeType, data, schema };
}

async function requestJson(url, { token, method = 'GET', body, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: controller.signal
    });
    const status = Number(response?.status || 0);
    if (!response?.ok) {
      controller.abort();
      return { ok: false, status };
    }
    try {
      return { ok: true, status, body: await response.json() };
    } catch {
      return { ok: false, status, reason: controller.signal.aborted ? 'TIMEOUT' : 'INVALID_RESPONSE' };
    }
  } catch {
    return { ok: false, status: 0, reason: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR' };
  } finally {
    clearTimeout(timer);
  }
}

function supportsVision(model) {
  const input = Array.isArray(model?.modalities?.input) ? model.modalities.input : [];
  const output = Array.isArray(model?.modalities?.output) ? model.modalities.output : [];
  return input.includes('image') && input.includes('text') && output.includes('text');
}

export function chooseCashPhotoGatewayModels(models = []) {
  const available = new Map((Array.isArray(models) ? models : [])
    .filter(model => model && typeof model === 'object' && !Array.isArray(model))
    .map(model => [String(model.id || '').trim(), model]));
  return PREFERRED_MODELS.filter(modelId => supportsVision(available.get(modelId)));
}

function parseStructuredContent(value) {
  let source = String(value ?? '').trim();
  if (source.startsWith('```')) {
    source = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  let data;
  try {
    data = JSON.parse(source);
  } catch {
    throw permanentError('INVALID_JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.operations)) {
    throw permanentError('MISSING_OPERATIONS');
  }
  return data;
}

export async function probeCashPhotoGateway({
  gatewayToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000
} = {}) {
  let token;
  try {
    token = boundedToken(gatewayToken);
  } catch {
    return { ok: false, reason: 'GATEWAY_TOKEN_UNAVAILABLE', models: [] };
  }
  const response = await requestJson(MODELS_URL, { token, timeoutMs, fetchImpl });
  if (!response.ok) {
    return { ok: false, reason: response.reason || `HTTP_${response.status}`, models: [] };
  }
  const models = chooseCashPhotoGatewayModels(response.body?.data || []);
  return models.length
    ? { ok: true, models }
    : { ok: false, reason: 'VISION_MODELS_UNAVAILABLE', models: [] };
}

export async function recognizeCashPhotoViaGateway({
  gatewayToken,
  payload,
  fetchImpl = globalThis.fetch,
  catalogTimeoutMs = 5_000,
  requestTimeoutMs = 14_000
} = {}) {
  if (typeof fetchImpl !== 'function') throw permanentError('FETCH_UNAVAILABLE');
  const token = boundedToken(gatewayToken);
  const { prompt, mimeType, data, schema } = payloadParts(payload);
  const catalog = await requestJson(MODELS_URL, {
    token,
    timeoutMs: catalogTimeoutMs,
    fetchImpl
  });
  if (!catalog.ok) {
    throw retryableError([`gateway catalog: ${catalog.reason || `HTTP ${catalog.status}`}`]);
  }
  const models = chooseCashPhotoGatewayModels(catalog.body?.data || []);
  if (!models.length) throw retryableError(['gateway vision models unavailable']);

  const diagnostics = [];
  for (const model of models) {
    const response = await requestJson(CHAT_URL, {
      token,
      method: 'POST',
      timeoutMs: requestTimeoutMs,
      fetchImpl,
      body: {
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${data}`,
                detail: 'auto'
              }
            }
          ]
        }],
        stream: false,
        max_tokens: 8_000,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'cash_journal_recognition',
            description: 'Structured recognition of one Vector cash journal page.',
            schema
          }
        }
      }
    });

    if (response.ok) {
      const content = response.body?.choices?.[0]?.message?.content;
      if (content === undefined || content === null) throw permanentError('MISSING_CONTENT', 0, diagnostics);
      return {
        model,
        data: parseStructuredContent(content),
        diagnostics
      };
    }

    const detail = response.reason || `HTTP ${response.status}`;
    diagnostics.push(`${model}: ${detail}`);
    if (response.status && !RETRYABLE_GATEWAY_STATUS.has(response.status) && !response.reason) {
      throw permanentError(`HTTP_${response.status}`, response.status, diagnostics);
    }
  }

  throw retryableError(diagnostics);
}

export async function recognizeCashPhotoWithGatewayFallback({
  primaryRecognize,
  gatewayRecognize
} = {}) {
  if (typeof primaryRecognize !== 'function' || typeof gatewayRecognize !== 'function') {
    throw permanentError('INVALID_CONFIGURATION');
  }

  try {
    return await primaryRecognize();
  } catch (error) {
    if (error?.retryable !== true) throw error;
    const primaryDiagnostics = Array.isArray(error?.diagnostics) ? error.diagnostics : [];
    try {
      const fallback = await gatewayRecognize();
      return {
        ...fallback,
        diagnostics: [
          ...primaryDiagnostics,
          `gateway fallback: ${String(fallback?.model || 'unknown')}`,
          ...(Array.isArray(fallback?.diagnostics) ? fallback.diagnostics : [])
        ]
      };
    } catch (fallbackError) {
      if (fallbackError?.retryable !== true) throw fallbackError;
      throw retryableError([
        ...primaryDiagnostics,
        ...(Array.isArray(fallbackError?.diagnostics) ? fallbackError.diagnostics : ['gateway fallback unavailable'])
      ]);
    }
  }
}
