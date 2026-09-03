import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectResponseCookies,
  createAshkWebSession,
  extractAntiForgeryToken
} from '../lib/ashk-web-session.js';

function response({ status = 200, body = '', cookies = [], contentType = 'application/json' }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: name => name.toLowerCase() === 'content-type' ? contentType : null,
      getSetCookie: () => cookies
    },
    text: async () => typeof body === 'string' ? body : JSON.stringify(body)
  };
}

test('extracts ASHK anti-forgery token regardless of attribute order', () => {
  assert.equal(
    extractAntiForgeryToken('<input name="__RequestVerificationToken" type="hidden" value="token-123">'),
    'token-123'
  );
  assert.equal(
    extractAntiForgeryToken('<input value="token-456" type="hidden" name="__RequestVerificationToken">'),
    'token-456'
  );
});

test('collects cookie name/value pairs without persisting attributes', () => {
  const headers = { getSetCookie: () => [
    '.AspNetCore.Antiforgery=x; path=/; secure; httponly',
    '.AspNetCore.Cookies=y; path=/; secure; httponly'
  ] };
  assert.equal(
    collectResponseCookies(headers),
    '.AspNetCore.Antiforgery=x; .AspNetCore.Cookies=y'
  );
});

test('logs in and reads SaleList with session cookies', async () => {
  const calls = [];
  const replies = [
    response({
      body: '<input name="__RequestVerificationToken" value="csrf">',
      cookies: ['anti=a; path=/'],
      contentType: 'text/html'
    }),
    response({ body: { success: true, data: {} }, cookies: ['session=b; path=/'] }),
    response({ body: { success: true, data: [{ Id: 77, EmployeeName: 'Шумилова Полина' }] } })
  ];
  const session = createAshkWebSession({
    baseUrl: 'https://app.dscontrol.ru',
    login: 'current-user',
    password: 'secret',
    fetchFn: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return replies.shift();
    }
  });

  const sales = await session.requestJson('/api/SaleList', { Period: 'Today' });
  assert.equal(sales.data[0].Id, 77);
  assert.equal(calls[1].options.headers.__RequestVerificationToken, 'csrf');
  assert.match(calls[2].options.headers.Cookie, /session=b/);
  assert.match(calls[2].url, /Period=Today/);
});

test('re-authenticates only once after an expired session', async () => {
  let loginGets = 0;
  let apiCalls = 0;
  const session = createAshkWebSession({
    baseUrl: 'https://app.dscontrol.ru',
    login: 'current-user',
    password: 'secret',
    fetchFn: async url => {
      const value = String(url);
      if (value === 'https://app.dscontrol.ru/') {
        loginGets += 1;
        return response({ body: '<input name="__RequestVerificationToken" value="csrf">', contentType: 'text/html' });
      }
      if (value === 'https://app.dscontrol.ru/Login') {
        return response({ body: { success: true, data: {} }, cookies: [`session=${loginGets}`] });
      }
      apiCalls += 1;
      if (apiCalls === 1) return response({ status: 401, body: { success: false } });
      return response({ body: { success: true, data: [] } });
    }
  });

  await session.requestJson('/api/SaleList', { Period: 'Today' });
  assert.equal(loginGets, 2);
  assert.equal(apiCalls, 2);
});

test('fails without exposing sensitive login response details', async () => {
  const session = createAshkWebSession({
    baseUrl: 'https://app.dscontrol.ru',
    login: 'current-user',
    password: 'secret-password',
    fetchFn: async url => String(url).endsWith('/Login')
      ? response({ status: 401, body: 'secret-password session-cookie', contentType: 'text/html' })
      : response({ body: '<input name="__RequestVerificationToken" value="csrf-secret">', contentType: 'text/html' })
  });

  await assert.rejects(
    session.authenticate(),
    error => !/secret-password|session-cookie|csrf-secret/.test(error.message)
  );
});
