import { validateSafePath } from './hourly-agent-runner-policy.js';

const EXPECTED = Object.freeze({
  issuer: 'https://token.actions.githubusercontent.com',
  audience: 'vector-hourly-agent-v1',
  repository: 'miros2012/vector-ashk-vercel',
  repositoryId: '1350493825',
  ownerId: '46207692',
  ref: 'refs/heads/main',
  workflowRef: 'miros2012/vector-ashk-vercel/.github/workflows/hourly-project-continuation.yml@refs/heads/main',
  subject: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main'
});

const MAX_FILES = 6;
const MAX_FILE_BYTES = 80_000;
const MAX_TOTAL_BYTES = 250_000;
const MAX_REQUEST_ID = 160;
const SUPPORTED_MODELS = [
  'openai/gpt-5.6-sol',
  'openai/gpt-5.4',
  'openai/gpt-5.3-codex',
  'openai/gpt-5.2-codex',
  'openai/gpt-5.2',
  'openai/gpt-5.1'
];
const MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models';
const CHAT_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

function text(value) {
  return String(value ?? '').trim();
}

function requiredText(value, name, maxLength = 20_000) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${name} is required`);
  if (normalized.length > maxLength) throw new Error(`${name} is too long`);
  return normalized;
}

function positiveIntegerText(value, name) {
  const normalized = requiredText(value, name, 40);
  if (!/^\d+$/.test(normalized) || Number(normalized) < 1) throw new Error(`${name} is invalid`);
  return normalized;
}

function normalizePath(value) {
  return validateSafePath(value);
}

function normalizeFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) {
    throw new Error(`task files must contain 1-${MAX_FILES} entries`);
  }
  let totalBytes = 0;
  const seen = new Set();
  return files.map((file) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('task file is invalid');
    const path = normalizePath(file.path);
    if (seen.has(path)) throw new Error(`duplicate file path: ${path}`);
    seen.add(path);
    const content = String(file.content ?? '');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_FILE_BYTES) throw new Error(`file content is too large: ${path}`);
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('task file content exceeds aggregate limit');
    return { path, content, exists: Boolean(file.exists) };
  });
}

function parseBearer(authorization) {
  const match = String(authorization || '').match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || '';
}

function responseJson(response) {
  if (!response || typeof response.json !== 'function') throw new Error('gateway response is invalid');
  return response.json();
}

function parseStructuredContent(value) {
  let source = String(value ?? '').trim();
  if (source.startsWith('```')) {
    source = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error('gateway returned invalid structured output');
  }
}

function normalizeUsage(usage = {}) {
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? inputTokens + outputTokens);
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0
  };
}

function signedRunKey(claims) {
  return `${positiveIntegerText(claims.run_id, 'run_id')}-attempt-${positiveIntegerText(claims.run_attempt, 'run_attempt')}`;
}

function requestMatchesSignedRun(claims, mode, request, requestId) {
  const runKey = signedRunKey(claims);
  const expected = mode === 'hourly_agent_probe'
    ? `gha-${runKey}-probe`
    : `gha-${runKey}-${request.issueNumber}-${request.attempt}`;
  return requestId === expected;
}

export function authorizeHourlyAgentClaims(claims = {}) {
  const eventName = text(claims.event_name);
  const audience = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud || '')];
  const valid = claims.iss === EXPECTED.issuer
    && audience.includes(EXPECTED.audience)
    && claims.sub === EXPECTED.subject
    && claims.repository === EXPECTED.repository
    && String(claims.repository_id) === EXPECTED.repositoryId
    && String(claims.repository_owner_id) === EXPECTED.ownerId
    && claims.ref === EXPECTED.ref
    && claims.workflow_ref === EXPECTED.workflowRef
    && ['schedule', 'issues', 'workflow_dispatch'].includes(eventName);
  if (!valid) throw new Error('forbidden hourly agent claims');
  positiveIntegerText(claims.run_id, 'run_id');
  positiveIntegerText(claims.run_attempt, 'run_attempt');
  if (['issues', 'workflow_dispatch'].includes(eventName)
      && String(claims.actor_id) !== EXPECTED.ownerId) {
    throw new Error('forbidden hourly agent actor');
  }
  return { eventName };
}

export function validateHourlyAgentRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('request body is invalid');
  if (body.mode !== 'hourly_agent_patch') throw new Error('unsupported hourly agent mode');
  const requestId = requiredText(body.requestId, 'requestId', MAX_REQUEST_ID);
  if (!/^[A-Za-z0-9._:-]+$/.test(requestId)) throw new Error('requestId is invalid');

  const task = body.task;
  if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('task is required');
  const issueNumber = Number(task.issueNumber);
  if (!Number.isInteger(issueNumber) || issueNumber < 1) throw new Error('issueNumber is invalid');
  const title = requiredText(task.title, 'task title', 500);
  if (!title.startsWith('[agent-ready]')) throw new Error('task title is not agent-ready');
  const attempt = Number(task.attempt);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 2) throw new Error('task attempt is invalid');
  const files = normalizeFiles(task.files);

  return {
    mode: body.mode,
    requestId,
    issueNumber,
    title,
    body: String(task.body ?? '').slice(0, 30_000),
    attempt,
    testFailure: String(task.testFailure ?? '').slice(0, 12_000),
    files,
    allowedPaths: files.map((file) => file.path)
  };
}

export function validateHourlyAgentProposal(proposal, request) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    throw new Error('agent proposal is invalid');
  }
  const allowed = new Set(request.allowedPaths || []);
  const changes = Array.isArray(proposal.changes) ? proposal.changes : [];
  const needsHumanReview = Boolean(proposal.needsHumanReview);
  if (changes.length === 0 && !needsHumanReview) {
    throw new Error('agent proposal must include changes or require human review');
  }
  if (changes.length > MAX_FILES) throw new Error('agent proposal has too many changes');

  const seen = new Set();
  let totalBytes = 0;
  const normalizedChanges = changes.map((change) => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('agent change is invalid');
    const path = normalizePath(change.path);
    if (!allowed.has(path)) throw new Error(`agent change path is not allowed: ${path}`);
    if (seen.has(path)) throw new Error(`agent proposal contains duplicate path: ${path}`);
    seen.add(path);
    const content = String(change.content ?? '');
    totalBytes += Buffer.byteLength(content, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('agent proposal content exceeds size limit');
    }
    return {
      path,
      content,
      reason: requiredText(change.reason, 'change reason', 1_000)
    };
  });

  const testPlan = Array.isArray(proposal.testPlan)
    ? proposal.testPlan.map((step) => requiredText(step, 'test plan step', 500)).slice(0, 12)
    : [];
  const confidence = ['low', 'medium', 'high'].includes(proposal.confidence)
    ? proposal.confidence
    : 'low';
  const reviewReason = String(proposal.reviewReason ?? '').trim().slice(0, 2_000);
  if (needsHumanReview && !reviewReason) throw new Error('reviewReason is required');

  return {
    summary: requiredText(proposal.summary, 'proposal summary', 2_000),
    changes: normalizedChanges,
    testPlan,
    confidence,
    needsHumanReview,
    reviewReason
  };
}

export function chooseGatewayModel(models = []) {
  const available = new Set((Array.isArray(models) ? models : [])
    .map((model) => text(typeof model === 'string' ? model : model?.id))
    .filter(Boolean));
  for (const model of SUPPORTED_MODELS) {
    if (available.has(model)) return model;
  }
  throw new Error('no supported AI Gateway model is available');
}

function patchSystemPrompt() {
  return [
    'You are a bounded software maintenance agent for the Vector finance backend.',
    'Return JSON only. Never use markdown fences.',
    'You may change only the explicitly supplied file paths.',
    'Return complete replacement file contents, never diffs.',
    'Do not infer or modify business facts, payment classifications, secrets, workflows, API routes, package files, or production financial data.',
    'Prefer the smallest change that satisfies the task and existing tests.',
    'When the task is ambiguous or unsafe, return changes=[] and needsHumanReview=true.',
    'Schema: {summary:string,changes:[{path:string,content:string,reason:string}],testPlan:string[],confidence:"low"|"medium"|"high",needsHumanReview:boolean,reviewReason:string}.'
  ].join('\n');
}

function patchUserPrompt(request) {
  return JSON.stringify({
    requestId: request.requestId,
    issueNumber: request.issueNumber,
    title: request.title,
    task: request.body,
    attempt: request.attempt,
    priorTestFailure: request.testFailure,
    allowedFiles: request.files
  });
}

async function callGateway({ fetchImpl, gatewayToken, model, messages, maxTokens = 12_000 }) {
  const response = await fetchImpl(CHAT_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${gatewayToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' }
    })
  });
  if (!response?.ok) throw new Error(`gateway completion failed with status ${response?.status || 0}`);
  const payload = await responseJson(response);
  const content = payload?.choices?.[0]?.message?.content;
  if (content === undefined || content === null) throw new Error('gateway completion content is missing');
  return { parsed: parseStructuredContent(content), usage: normalizeUsage(payload.usage) };
}

export function createHourlyProjectAgentService({
  verifyToken,
  getGatewayToken,
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  if (typeof verifyToken !== 'function') throw new Error('verifyToken is required');
  if (typeof getGatewayToken !== 'function') throw new Error('getGatewayToken is required');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');

  return async function hourlyProjectAgentService({ authorization, body } = {}) {
    const token = parseBearer(authorization);
    if (!token) return { status: 403, body: { ok: false, error: 'forbidden' } };

    let claims;
    try {
      claims = await verifyToken(token);
      authorizeHourlyAgentClaims(claims);
    } catch (error) {
      logger.warn?.('hourly-agent-auth:', error?.name || 'Error');
      return { status: 403, body: { ok: false, error: 'forbidden' } };
    }

    let mode;
    let request;
    let requestId;
    try {
      mode = body?.mode;
      requestId = requiredText(body?.requestId, 'requestId', MAX_REQUEST_ID);
      if (mode === 'hourly_agent_patch') request = validateHourlyAgentRequest(body);
      else if (mode !== 'hourly_agent_probe') throw new Error('unsupported hourly agent mode');
    } catch (error) {
      logger.warn?.('hourly-agent-request:', error?.name || 'Error');
      return { status: 400, body: { ok: false, error: 'invalid hourly agent request' } };
    }

    try {
      if (!requestMatchesSignedRun(claims, mode, request, requestId)) {
        return { status: 403, body: { ok: false, error: 'forbidden' } };
      }
    } catch (error) {
      logger.warn?.('hourly-agent-binding:', error?.name || 'Error');
      return { status: 403, body: { ok: false, error: 'forbidden' } };
    }

    try {
      const gatewayToken = requiredText(await getGatewayToken(), 'gateway token', 20_000);
      const modelResponse = await fetchImpl(MODELS_URL, {
        method: 'GET',
        headers: { authorization: `Bearer ${gatewayToken}`, accept: 'application/json' }
      });
      if (!modelResponse?.ok) throw new Error(`gateway catalog failed with status ${modelResponse?.status || 0}`);
      const modelPayload = await responseJson(modelResponse);
      const model = chooseGatewayModel(modelPayload?.data || modelPayload?.models || []);

      if (mode === 'hourly_agent_probe') {
        const { parsed } = await callGateway({
          fetchImpl,
          gatewayToken,
          model,
          messages: [
            { role: 'system', content: 'Return JSON only: {"marker":"VERCEL_AGENT_OK"}.' },
            { role: 'user', content: 'Authenticated hourly agent connectivity probe.' }
          ],
          maxTokens: 100
        });
        if (parsed?.marker !== 'VERCEL_AGENT_OK') throw new Error('gateway probe marker mismatch');
        return { status: 200, body: { ok: true, marker: parsed.marker, model } };
      }

      const { parsed, usage } = await callGateway({
        fetchImpl,
        gatewayToken,
        model,
        messages: [
          { role: 'system', content: patchSystemPrompt() },
          { role: 'user', content: patchUserPrompt(request) }
        ]
      });
      const proposal = validateHourlyAgentProposal(parsed, request);
      return {
        status: 200,
        body: { ok: true, model, proposal, usage }
      };
    } catch (error) {
      logger.error?.('hourly-agent-generation:', error?.name || 'Error');
      return { status: 502, body: { ok: false, error: 'hourly agent generation failed' } };
    }
  };
}
