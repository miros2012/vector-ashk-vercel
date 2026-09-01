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
  timeoutMs = 8000
} = {}) {
  if (typeof fetchFn !== 'function') throw new Error('fetchFn is required');
  if (!String(apiKey || '').trim()) throw new Error('apiKey is required');

  const workerCount = positiveInteger(concurrency, 4);
  const timeout = positiveInteger(timeoutMs, 8000);
  const headers = {
    api_key: String(apiKey),
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json'
  };

  async function getJson(path, publicError) {
    try {
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
