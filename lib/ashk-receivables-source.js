function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function positiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function createAshkReceivablesSource({
  fetchFn = fetch,
  baseUrl = 'https://app.dscontrol.ru',
  apiKey,
  concurrency = 4,
  timeoutMs = 8000,
  minIntervalMs = 350,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  if (typeof fetchFn !== 'function') throw new Error('fetchFn is required');
  if (!String(apiKey || '').trim()) throw new Error('apiKey is required');
  if (typeof now !== 'function') throw new Error('now is required');
  if (typeof sleep !== 'function') throw new Error('sleep is required');

  const workerCount = positiveInteger(concurrency, 4);
  const timeout = positiveInteger(timeoutMs, 8000);
  const interval = positiveInteger(minIntervalMs, 350);
  const headers = {
    api_key: String(apiKey),
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json'
  };

  let nextStartAt = 0;
  let rateGate = Promise.resolve();

  async function waitForRateSlot() {
    const previous = rateGate;
    let release;
    rateGate = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const current = Number(now());
      const waitMs = Math.max(0, nextStartAt - (Number.isFinite(current) ? current : 0));
      if (waitMs > 0) await sleep(waitMs);
      const startedAt = Number(now());
      nextStartAt = (Number.isFinite(startedAt) ? startedAt : nextStartAt) + interval;
    } finally {
      release();
    }
  }

  async function getJson(path, publicError) {
    try {
      await waitForRateSlot();
      const response = await fetchFn(`${String(baseUrl).replace(/\/$/, '')}${path}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeout)
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('invalid_json');
      }
      if (!response.ok || payload?.success === false) {
        throw new Error('ashk_error');
      }
      return payload;
    } catch {
      throw new Error(publicError);
    }
  }

  async function fetchCurrent() {
    const groupPayload = await getJson('/api/StudyGroupList', 'ASHK StudyGroupList failed');
    const groups = asArray(groupPayload);
    const queue = groups
      .filter(group => Number.isFinite(Number(group?.Id)))
      .filter(group => Number(group?.StudentCount ?? 0) > 0);
    const contractsByGroup = new Map();
    let cursor = 0;

    async function worker() {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= queue.length) return;
        const group = queue[index];
        const groupId = Number(group.Id);
        const payload = await getJson(
          `/api/StudentExternalList?StudyGroupId=${encodeURIComponent(groupId)}`,
          `ASHK StudentExternalList failed for group ${groupId}`
        );
        contractsByGroup.set(groupId, asArray(payload));
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(workerCount, Math.max(queue.length, 1)) }, () => worker())
    );

    return { groups, contractsByGroup };
  }

  return { fetchCurrent };
}
