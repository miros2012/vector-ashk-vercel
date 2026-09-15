function positiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function isTransientAshkStatus(status) {
  const value = Number(status);
  return value === 429 || (value >= 500 && value <= 599);
}

export async function fetchAshkWithRetry({
  fetchFn = fetch,
  url,
  options = {},
  maxAttempts = 2,
  retryDelayMs = 250,
  beforeAttempt = async () => {},
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  if (typeof fetchFn !== 'function') throw new Error('fetchFn is required');
  if (typeof beforeAttempt !== 'function') throw new Error('beforeAttempt is required');
  if (typeof sleep !== 'function') throw new Error('sleep is required');
  const attempts = positiveInteger(maxAttempts, 2);
  const delay = Math.max(Number(retryDelayMs) || 0, 0);

  let response;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await beforeAttempt(attempt);
    const requestOptions = typeof options === 'function' ? options(attempt) : options;
    response = await fetchFn(url, requestOptions);
    if (!isTransientAshkStatus(response?.status) || attempt === attempts) return response;
    if (delay > 0) await sleep(delay * attempt);
  }
  return response;
}
