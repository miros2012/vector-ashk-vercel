function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

export function extractAntiForgeryToken(html) {
  const inputs = String(html ?? '').match(/<input\b[^>]*>/gi) || [];
  const input = inputs.find(value => /\bname=["']__RequestVerificationToken["']/i.test(value)) || '';
  const token = input.match(/\bvalue=["']([^"']+)["']/i)?.[1] || '';
  if (!token) throw new Error('ASHK anti-forgery token missing');
  return decodeHtml(token);
}

export function collectResponseCookies(headers) {
  const raw = typeof headers?.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers?.get?.('set-cookie') || ''];
  return raw
    .flatMap(value => String(value).split(/,(?=\s*[^;,=]+=[^;,]+)/))
    .map(value => value.split(';', 1)[0].trim())
    .filter(Boolean)
    .join('; ');
}

function mergeCookies(current, incoming) {
  const cookies = new Map();
  for (const source of [current, incoming]) {
    for (const pair of String(source ?? '').split(';')) {
      const trimmed = pair.trim();
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      cookies.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
    }
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

function parseJson(value, message) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(message);
  }
}

export function createAshkWebSession({ baseUrl, login, password, fetchFn = fetch }) {
  if (!baseUrl) throw new Error('ASHK web base URL missing');
  if (!login || !password) throw new Error('ASHK web credentials missing');
  let cookie = '';

  async function authenticate() {
    const page = await fetchFn(`${baseUrl}/login`, { redirect: 'manual' });
    if (!page.ok) throw new Error(`ASHK login page failed: ${page.status}`);
    const token = extractAntiForgeryToken(await page.text());
    cookie = mergeCookies(cookie, collectResponseCookies(page.headers));

    const loginResponse = await fetchFn(`${baseUrl}/Login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        '__RequestVerificationToken': token,
        Cookie: cookie
      },
      body: new URLSearchParams({ Login: login, Password: password, PreventPass: 'false' }).toString()
    });
    const json = parseJson(await loginResponse.text(), 'ASHK login returned non-JSON');
    if (!loginResponse.ok || json?.success === false) throw new Error('ASHK login failed');
    if (json?.data?.TwoFactorAuthRequired || json?.TwoFactorAuthRequired) {
      throw new Error('ASHK two-factor authentication required');
    }
    cookie = mergeCookies(cookie, collectResponseCookies(loginResponse.headers));
  }

  async function requestJson(path, params = {}, retried = false) {
    if (!cookie) await authenticate();
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    const response = await fetchFn(url, {
      headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' }
    });
    if ((response.status === 401 || response.status === 403) && !retried) {
      cookie = '';
      await authenticate();
      return requestJson(path, params, true);
    }
    const json = parseJson(await response.text(), 'ASHK authenticated endpoint returned non-JSON');
    if (!response.ok || json?.success === false) {
      throw new Error(`ASHK web request failed: ${response.status}`);
    }
    return json;
  }

  return { authenticate, requestJson };
}
