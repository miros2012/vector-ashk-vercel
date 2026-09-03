# ASHK Sale Employee Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attribute each ASHK payment to the employee who conducted its sale, while preserving branch performance and protecting the live ROP dashboard behind staging verification.

**Architecture:** Add an authenticated ASHK web-session client that reads internal `SaleList`/`SaleGet` data, then join public payment records to sales by `SaleId`. Write seller attribution and sales data to staging, make the ROP personal fact consume only `SaleEmployeeName`, and leave branch fact based on the existing contract-to-branch mapping.

**Tech Stack:** Node.js 20 ESM, native `fetch`, `node:test`, Google Sheets API through `googleapis`, Vercel serverless functions and cron.

**Spec:** `docs/superpowers/specs/2026-09-03-ashk-sale-employee-attribution-design.md`

## Global Constraints

- Reuse `api/sync-payments.js`; do not add another `api/*.js` function.
- Keep the current live ROP sheets unchanged until staging checks and manual ASHK cross-checks pass.
- Personal sales/payment facts must use `Sale.EmployeeName`; never fall back to `StudentOwnerName`, contract owner, `PaymentEmployeeName`, or cashbox operator.
- Payment amount and payment date continue to come from `PaymentRecordExternalDebitList`.
- Preserve the separate branch plan/fact metric and its current meaning.
- Store `ASHK_WEB_LOGIN` and `ASHK_WEB_PASSWORD` only in encrypted Vercel environment variables.
- Never log or persist credentials, cookies, anti-forgery tokens, or full login responses.
- Keep session cookies in memory only for one serverless invocation.
- On `401/403`, re-authenticate once; on a second failure, fail the new staging run closed.
- Preserve all unrelated uncommitted files in the current worktree.

---

## File Structure

- Create `lib/ashk-web-session.js`: login-page token extraction, cookie handling, login, authenticated JSON requests, and one retry after session expiry.
- Create `lib/ashk-sale-attribution.js`: sale-period loading, missing `SaleId` detail loading, deterministic payment-to-sale attribution, and attribution metrics.
- Modify `api/sync-payments.js`: combine public payments, comparison-only cashbox data, internal sales data, and Google staging writes.
- Modify `lib/rop-daily-control.js`: consume `SaleEmployeeName` for personal fact and preserve contract branch for branch fact.
- Modify `api/nightly-finance-orchestrator.js`: read the expanded payment staging range and write the expanded attribution diagnostics range.
- Create `test/ashk-web-session.test.js`: web-session unit tests.
- Create `test/ashk-sale-attribution.test.js`: sale source and pure join tests.
- Modify `test/rop-daily-control.test.js`: regression tests for seller-vs-owner-vs-cashier behavior.
- Modify `test/nightly-rop-wiring.test.js`: staging-range and no-extra-function wiring checks.

---

### Task 1: Authenticated ASHK Web Session

**Files:**
- Create: `lib/ashk-web-session.js`
- Create: `test/ashk-web-session.test.js`

**Interfaces:**
- Consumes: `baseUrl`, `login`, `password`, and injected `fetchFn`.
- Produces: `extractAntiForgeryToken(html)`, `collectResponseCookies(headers)`, and `createAshkWebSession(options)` with `authenticate()` and `requestJson(path, params)`.

- [ ] **Step 1: Write failing anti-forgery and cookie tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectResponseCookies,
  createAshkWebSession,
  extractAntiForgeryToken
} from '../lib/ashk-web-session.js';

test('extracts ASHK anti-forgery token', () => {
  const html = '<input name="__RequestVerificationToken" type="hidden" value="token-123">';
  assert.equal(extractAntiForgeryToken(html), 'token-123');
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/ashk-web-session.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/ashk-web-session.js`.

- [ ] **Step 3: Implement token extraction and cookie collection**

```js
function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

export function extractAntiForgeryToken(html) {
  const input = String(html ?? '').match(
    /<input\b[^>]*name=["']__RequestVerificationToken["'][^>]*>/i
  )?.[0] || '';
  const value = input.match(/\bvalue=["']([^"']+)["']/i)?.[1] || '';
  if (!value) throw new Error('ASHK anti-forgery token missing');
  return decodeHtml(value);
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
```

- [ ] **Step 4: Add failing login, authenticated request, and one-retry tests**

```js
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
      calls.push({ url, options });
      return replies.shift();
    }
  });

  const sales = await session.requestJson('/api/SaleList', { Period: 'Today' });
  assert.equal(sales.data[0].Id, 77);
  assert.match(calls[1].options.headers.__RequestVerificationToken, /csrf/);
  assert.match(calls[2].options.headers.Cookie, /session=b/);
});

test('re-authenticates only once after an expired session', async () => {
  let loginGets = 0;
  let apiCalls = 0;
  const session = createAshkWebSession({
    baseUrl: 'https://app.dscontrol.ru',
    login: 'current-user',
    password: 'secret',
    fetchFn: async url => {
      if (url.endsWith('/')) {
        loginGets += 1;
        return response({ body: '<input name="__RequestVerificationToken" value="csrf">', contentType: 'text/html' });
      }
      if (url.endsWith('/Login')) return response({ body: { success: true, data: {} }, cookies: [`session=${loginGets}`] });
      apiCalls += 1;
      if (apiCalls === 1) return response({ status: 401, body: { success: false } });
      return response({ body: { success: true, data: [] } });
    }
  });
  await session.requestJson('/api/SaleList', { Period: 'Today' });
  assert.equal(loginGets, 2);
  assert.equal(apiCalls, 2);
});
```

- [ ] **Step 5: Implement the session client**

Implement `createAshkWebSession` with these exact behaviors:

```js
export function createAshkWebSession({ baseUrl, login, password, fetchFn = fetch }) {
  if (!login || !password) throw new Error('ASHK web credentials missing');
  let cookie = '';

  async function authenticate() {
    const page = await fetchFn(`${baseUrl}/`, { redirect: 'manual' });
    const html = await page.text();
    const token = extractAntiForgeryToken(html);
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
      body: new URLSearchParams({ Login: login, Password: password }).toString()
    });
    const text = await loginResponse.text();
    const json = parseJson(text, 'ASHK login returned non-JSON');
    if (!loginResponse.ok || json?.success === false) throw new Error('ASHK login failed');
    if (json?.data?.TwoFactorAuthRequired) throw new Error('ASHK two-factor authentication required');
    cookie = mergeCookies(cookie, collectResponseCookies(loginResponse.headers));
  }

  async function requestJson(path, params = {}, retried = false) {
    if (!cookie) await authenticate();
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const response = await fetchFn(url, {
      headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' }
    });
    if ((response.status === 401 || response.status === 403) && !retried) {
      cookie = '';
      await authenticate();
      return requestJson(path, params, true);
    }
    const text = await response.text();
    const json = parseJson(text, 'ASHK authenticated endpoint returned non-JSON');
    if (!response.ok || json?.success === false) throw new Error(`ASHK web request failed: ${response.status}`);
    return json;
  }

  return { authenticate, requestJson };
}
```

Add private `mergeCookies` and `parseJson` helpers. `mergeCookies` must replace cookies by name, not append duplicate names. Errors must never include response bodies, credentials, cookie values, or tokens.

- [ ] **Step 6: Run tests and commit**

Run: `node --test test/ashk-web-session.test.js`

Expected: all tests PASS.

Commit:

```bash
git add lib/ashk-web-session.js test/ashk-web-session.test.js
git commit -m "feat: add authenticated ASHK web session"
```

---

### Task 2: Load Sales and Attribute Payments by SaleId

**Files:**
- Create: `lib/ashk-sale-attribution.js`
- Create: `test/ashk-sale-attribution.test.js`

**Interfaces:**
- Consumes: `session.requestJson(path, params)`, public payment objects, and a date period.
- Produces: `normalizeSaleId(value)`, `attributePaymentsToSales(payments, sales)`, and `createAshkSaleSource({ session, concurrency })` with `fetchForPayments({ payments, startDate, endDate })`.

- [ ] **Step 1: Write failing deterministic-attribution tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attributePaymentsToSales,
  createAshkSaleSource,
  normalizeSaleId
} from '../lib/ashk-sale-attribution.js';

test('normalizes numeric SaleId without fuzzy matching', () => {
  assert.equal(normalizeSaleId(' 00123 '), '123');
  assert.equal(normalizeSaleId(null), '');
});

test('attributes payment only through matching SaleId and sale employee', () => {
  const result = attributePaymentsToSales([
    { Id: 1, SaleId: 77, StudentId: 10, Debit: 15100 }
  ], [
    { Id: 77, EmployeeName: 'Шумилова Полина', StudentOwnerName: 'Другой сотрудник' }
  ]);
  assert.equal(result.items[0].SaleEmployeeName, 'Шумилова Полина');
  assert.equal(result.items[0].SaleAttributionStatus, 'OK_SALE_EMPLOYEE');
  assert.deepEqual(result.metrics, {
    total: 1,
    attributed: 1,
    saleIdEmpty: 0,
    saleNotFound: 0,
    employeeEmpty: 0
  });
});

test('does not fall back to owner or cashbox employee', () => {
  const result = attributePaymentsToSales([
    { Id: 1, SaleId: 77, PaymentEmployeeName: 'Кассир' }
  ], [
    { Id: 77, EmployeeName: '', StudentOwnerName: 'Ответственный' }
  ]);
  assert.equal(result.items[0].SaleEmployeeName, '');
  assert.equal(result.items[0].SaleAttributionStatus, 'SALE_EMPLOYEE_EMPTY');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/ashk-sale-attribution.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the pure join and metrics**

```js
export function normalizeSaleId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

export function attributePaymentsToSales(payments, sales) {
  const saleById = new Map((sales || []).map(sale => [normalizeSaleId(sale?.Id), sale]));
  const metrics = { total: 0, attributed: 0, saleIdEmpty: 0, saleNotFound: 0, employeeEmpty: 0 };
  const items = (payments || []).map(payment => {
    metrics.total += 1;
    const saleId = normalizeSaleId(payment?.SaleId);
    if (!saleId) {
      metrics.saleIdEmpty += 1;
      return { ...payment, SaleEmployeeName: '', SaleAttributionStatus: 'SALE_ID_EMPTY' };
    }
    const sale = saleById.get(saleId);
    if (!sale) {
      metrics.saleNotFound += 1;
      return { ...payment, SaleEmployeeName: '', SaleAttributionStatus: 'SALE_NOT_FOUND' };
    }
    const employee = String(sale?.EmployeeName ?? '').trim();
    if (!employee) {
      metrics.employeeEmpty += 1;
      return { ...payment, SaleEmployeeName: '', SaleAttributionStatus: 'SALE_EMPLOYEE_EMPTY' };
    }
    metrics.attributed += 1;
    return { ...payment, SaleEmployeeName: employee, SaleAttributionStatus: 'OK_SALE_EMPLOYEE' };
  });
  return { items, metrics };
}
```

- [ ] **Step 4: Add failing SaleList plus SaleGet fallback test**

```js
test('loads period sales and resolves older referenced sales through SaleGet', async () => {
  const calls = [];
  const session = {
    requestJson: async (path, params) => {
      calls.push({ path, params });
      if (path === '/api/SaleList') {
        return { data: [{ Id: 77, EmployeeName: 'Шумилова Полина', Date: '2026-09-02' }] };
      }
      assert.equal(params.param, '55');
      return { data: { Id: 55, EmployeeName: 'Кузнецова Марина', Date: '2026-08-10' } };
    }
  };
  const source = createAshkSaleSource({ session, concurrency: 2 });
  const result = await source.fetchForPayments({
    payments: [{ SaleId: 77 }, { SaleId: 55 }, { SaleId: 55 }],
    startDate: '2026-09-01',
    endDate: '2026-09-03'
  });
  assert.deepEqual(result.sales.map(item => item.Id).sort(), [55, 77]);
  assert.equal(calls.filter(call => call.path === '/api/SaleGet').length, 1);
});
```

- [ ] **Step 5: Implement the internal sales source**

`fetchForPayments` must call:

```js
await session.requestJson('/api/SaleList', {
  Period: 'Custom',
  StartDate: startDate,
  EndDate: endDate,
  IncludeWalletSales: false
});
```

It then builds a map by normalized `Id`, collects unique non-empty payment `SaleId` values absent from the period list, and resolves each once with:

```js
await session.requestJson('/api/SaleGet', { param: saleId });
```

Use a small local `mapLimit(values, concurrency, worker)` implementation with `concurrency` clamped to `1..6`. Return:

```js
{
  sales: [...saleById.values()],
  metrics: {
    periodSales: periodSales.length,
    referencedSaleIds: referencedIds.length,
    detailRequests: missingIds.length,
    resolvedSales: saleById.size
  }
}
```

- [ ] **Step 6: Run tests and commit**

Run: `node --test test/ashk-sale-attribution.test.js`

Expected: all tests PASS.

Commit:

```bash
git add lib/ashk-sale-attribution.js test/ashk-sale-attribution.test.js
git commit -m "feat: attribute ASHK payments by sale employee"
```

---

### Task 3: Write Seller Attribution to Staging

**Files:**
- Modify: `api/sync-payments.js`
- Modify: `test/cashbox-operation-attribution.test.js`
- Create: `test/sync-payments-sale-attribution-wiring.test.js`

**Interfaces:**
- Consumes: `createAshkWebSession`, `createAshkSaleSource`, `attributePaymentsToSales`, public payments, comparison-only cashbox operations, Google Sheets client.
- Produces: expanded `АШК_Оплаты__vercel!A:K`, new `АШК_Продажи__vercel!A:H`, and non-secret attribution metrics in the handler response.

- [ ] **Step 1: Write failing wiring assertions**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('payment sync writes sale employee attribution without adding an API function', async () => {
  const source = await readFile(new URL('../api/sync-payments.js', import.meta.url), 'utf8');
  assert.match(source, /createAshkWebSession/);
  assert.match(source, /createAshkSaleSource/);
  assert.match(source, /attributePaymentsToSales/);
  assert.match(source, /SaleEmployeeName/);
  assert.match(source, /SaleAttributionStatus/);
  assert.match(source, /АШК_Продажи__vercel/);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/sync-payments-sale-attribution-wiring.test.js test/cashbox-operation-attribution.test.js`

Expected: the new wiring test FAILS because web-session and sale-source imports are absent; the existing comparison-only cashbox tests remain PASS.

- [ ] **Step 3: Wire authenticated sales into `sync-payments.js`**

Add imports:

```js
import { createAshkWebSession } from '../lib/ashk-web-session.js';
import {
  attributePaymentsToSales,
  createAshkSaleSource
} from '../lib/ashk-sale-attribution.js';
```

Create the session only inside the handler so missing secrets fail at invocation time, not module import time:

```js
const session = createAshkWebSession({
  baseUrl: ASHK_BASE_URL,
  login: process.env.ASHK_WEB_LOGIN,
  password: process.env.ASHK_WEB_PASSWORD
});
const saleSource = createAshkSaleSource({ session, concurrency: 4 });
const saleResult = await saleSource.fetchForPayments({
  payments: rawItems,
  startDate: `${year}-${pad2(month)}-01`,
  endDate: `${year}-${pad2(month)}-${pad2(day)}`
});
const saleAttribution = attributePaymentsToSales(
  comparisonAttribution.items,
  saleResult.sales
);
```

Rename the current cashbox result locally to `comparisonAttribution`. Keep `PaymentEmployeeName` only for diagnostic comparison.

- [ ] **Step 4: Expand payment staging and add sales staging**

Use these exact payment headers and order:

```js
const headers = [[
  'Id','PayDate','StudentId','SaleId','ProductId','ProductName','SaleSum','Debit',
  'PaymentEmployeeName','SaleEmployeeName','SaleAttributionStatus'
]];
```

Write `АШК_Оплаты__vercel!A:K`. Keep payment total verification based on columns `A:H`.

Use these exact sales headers:

```js
const salesHeaders = [[
  'Id','Date','EmployeeName','StudentOwnerName','StudentId','ProductName','Sum','Paid'
]];
```

Write a deduplicated `АШК_Продажи__vercel!A:H`, then read it back and verify row count plus rounded totals of `Sum` and `Paid`. If payment or sales staging verification fails, return `502` and do not promote live ROP data.

- [ ] **Step 5: Return safe diagnostics**

Return and log only counts/totals:

```js
{
  saleSource: saleResult.metrics,
  saleAttribution: saleAttribution.metrics,
  cashboxComparison: comparisonAttribution.metrics,
  credentials: 'configured'
}
```

Do not include response bodies, cookies, login names, passwords, tokens, or full sale/payment rows.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
node --test \
  test/ashk-web-session.test.js \
  test/ashk-sale-attribution.test.js \
  test/cashbox-operation-attribution.test.js \
  test/sync-payments-sale-attribution-wiring.test.js
```

Expected: all tests PASS.

Commit only the task files, preserving unrelated worktree changes:

```bash
git add api/sync-payments.js test/cashbox-operation-attribution.test.js test/sync-payments-sale-attribution-wiring.test.js
git commit -m "feat: stage ASHK sale employee attribution"
```

---

### Task 4: Make ROP Personal Fact Use Only Sale Employee

**Files:**
- Modify: `lib/rop-daily-control.js`
- Modify: `test/rop-daily-control.test.js`
- Modify: `test/rop-unmatched-diagnostics.test.js`

**Interfaces:**
- Consumes: payment staging columns `SaleId`, `PaymentEmployeeName`, `SaleEmployeeName`, and `SaleAttributionStatus`.
- Produces: unchanged branch daily/MTD values, seller-based personal daily/MTD values, and expanded attribution diagnostics.

- [ ] **Step 1: Replace the old test with a failing seller-authority regression test**

Use a payment fixture where all three names differ:

```js
const paymentValues = [
  [
    'Id','PayDate','StudentId','SaleId','ProductId','ProductName','SaleSum','Debit',
    'PaymentEmployeeName','SaleEmployeeName','SaleAttributionStatus'
  ],
  [501,'2026-09-02 10:00:00',101,10,1,'Курс',50000,7000,
    'Кассир','Менеджер Б','OK_SALE_EMPLOYEE'],
  [502,'2026-09-02 11:00:00',101,11,1,'Курс',50000,3000,
    'Менеджер Б','','SALE_EMPLOYEE_EMPTY']
];
```

Assert:

```js
assert.equal(row('Менеджер А')[idx('Личный факт за день')], 0);
assert.equal(row('Менеджер Б')[idx('Личный факт за день')], 7000);
assert.equal(row('Менеджер А')[idx('Факт филиала за день')], 10000);
assert.match(JSON.stringify(workbook.paymentAttributionValues), /SALE_EMPLOYEE_EMPTY/);
assert.doesNotMatch(JSON.stringify(workbook.paymentAttributionValues), /LEGACY_OWNER_FALLBACK/);
```

- [ ] **Step 2: Run the focused ROP tests and verify RED**

Run: `node --test test/rop-daily-control.test.js test/rop-unmatched-diagnostics.test.js`

Expected: FAIL because `paymentRows` and the personal fact still use `PaymentEmployeeName`/legacy owner fallback.

- [ ] **Step 3: Parse seller columns and remove personal fallbacks**

Update `paymentRows(values)` to expose:

```js
{
  id,
  date,
  studentId,
  saleId,
  amount,
  paymentEmployee,
  saleEmployee,
  saleAttributionStatus
}
```

Require `SaleEmployeeName` and `SaleAttributionStatus` headers for the new path. For every matched contract, calculate:

```js
const creditedManager = payment.saleAttributionStatus === 'OK_SALE_EMPLOYEE'
  ? resolvePlannedManager(payment.saleEmployee)
  : '';
```

Do not read `contract.manager` or `payment.paymentEmployee` when assigning the personal fact.

- [ ] **Step 4: Expand diagnostic columns**

Use these exact headers:

```js
const PAYMENT_ATTRIBUTION_HEADERS = [
  'ID оплаты','Дата','StudentId','SaleId','Сумма','Филиал','Филиал АШК',
  'Менеджер АШК','Сотрудник кассовой операции','Сотрудник продажи АШК',
  'Зачтён менеджеру','Статус привязки'
];
```

The status must be:

- `OK_SALE_EMPLOYEE` when the seller resolves to an active planned manager;
- `SALE_EMPLOYEE_NOT_IN_ACTIVE_PLAN` when ASHK provides a seller absent from the active plan;
- the upstream `SALE_ID_EMPTY`, `SALE_NOT_FOUND`, or `SALE_EMPLOYEE_EMPTY` status when attribution is unresolved.

Change the shared-branch note to: `Личный факт считается по сотруднику, проводившему продажу в АШК.`

- [ ] **Step 5: Run tests and commit**

Run: `node --test test/rop-daily-control.test.js test/rop-unmatched-diagnostics.test.js`

Expected: all tests PASS, including unchanged branch-fact assertions.

Commit:

```bash
git add lib/rop-daily-control.js test/rop-daily-control.test.js test/rop-unmatched-diagnostics.test.js
git commit -m "fix: calculate personal fact by ASHK sale employee"
```

---

### Task 5: Wire Hourly Refresh and Staging Safety

**Files:**
- Modify: `api/nightly-finance-orchestrator.js`
- Modify: `test/nightly-rop-wiring.test.js`
- Modify: `test/nightly-rop-orchestration.test.js` if the existing handler contract assertions require the expanded diagnostics.

**Interfaces:**
- Consumes: `АШК_Оплаты__vercel!A:K` and the workbook’s 12-column `paymentAttributionValues`.
- Produces: hourly staging refresh followed by ROP source refresh/publish only after all existing and new validation gates pass.

- [ ] **Step 1: Add failing range and ordering tests**

Add assertions:

```js
assert.match(source, /readValues\(PAYMENTS_STAGING_SHEET, 'A:K'\)/);
assert.match(source, /writeValues\(ROP_PAYMENT_ATTRIBUTION_SHEET, 'A:L'/);
assert.match(source, /runPayments:[\s\S]*refreshRop/);
assert.doesNotMatch(source, /const\s+NEW_[A-Z_]*API_ROUTE/);
```

- [ ] **Step 2: Run the wiring test and verify RED**

Run: `node --test test/nightly-rop-wiring.test.js`

Expected: FAIL on the old `A:I` and `A:J` ranges.

- [ ] **Step 3: Expand orchestrator ranges without changing schedule**

Change every payment staging read used by ROP from `A:I` to `A:K`. Change attribution diagnostics writes/readbacks from `A:J` to `A:L`, set the expected column count to `12`, and verify the last header equals `Статус привязки` at index `11`.

Do not change `INTRADAY_SCHEDULES`, `TZ = 'Asia/Yekaterinburg'`, or the order `runPayments → refreshRop → publish`.

- [ ] **Step 4: Run focused orchestration tests and commit**

Run:

```bash
node --test \
  test/nightly-rop-wiring.test.js \
  test/nightly-rop-orchestration.test.js \
  test/rop-morning-dashboard-wiring.test.js \
  test/rop-tasks-today-live.test.js
```

Expected: all present test files PASS. If `test/nightly-rop-orchestration.test.js` is absent, omit that path and do not create an unrelated test file.

Commit:

```bash
git add api/nightly-finance-orchestrator.js test/nightly-rop-wiring.test.js
git commit -m "feat: wire sale attribution into hourly ROP refresh"
```

---

### Task 6: Configure Secrets, Run Live Staging Probe, and Promote

**Files:**
- Modify only if evidence requires a code correction: files from Tasks 1–5.
- No credentials file is created.

**Interfaces:**
- Consumes: Vercel encrypted secrets `ASHK_WEB_LOGIN`, `ASHK_WEB_PASSWORD`, existing `ASHK_API_KEY`, Google service account secrets, and the deployed staging route.
- Produces: verified staging evidence and, only after all gates pass, the corrected live ROP dashboard.

- [ ] **Step 1: Run the full local suite before deployment**

Run: `npm test`

Expected: exit code `0`, no failed tests, and no credential-like values in output.

- [ ] **Step 2: Review the worktree and commits**

Run:

```bash
git status --short
git log --oneline -6
git diff --check HEAD~5..HEAD
```

Expected: task commits are present; unrelated pre-existing modifications remain unstaged unless they were explicitly part of an approved task.

- [ ] **Step 3: Add current-account credentials to Vercel securely**

At action time, have the user enter the current ASHK login and password into the Vercel environment-variable fields named exactly:

```text
ASHK_WEB_LOGIN
ASHK_WEB_PASSWORD
```

Enable them for Production and Preview. Do not ask for or display either value in chat, terminal output, Git, Google Sheets, or logs.

- [ ] **Step 4: Deploy staging-enabled code**

Deploy the committed branch through the repository’s existing Vercel workflow. Confirm deployment status is `READY` and `/api/health` still reports ASHK and Google Sheets configured. Do not add a thirteenth serverless function.

- [ ] **Step 5: Invoke one staging-only payment synchronization**

Trigger the existing `POST /api/sync-payments` route once. Verify its safe response reports:

```text
ok = true
mode = staging_only
verified = true
credentials = configured
saleAttribution.attributed > 0
```

Verify `АШК_Оплаты__vercel` and `АШК_Продажи__vercel` readbacks match the returned row counts/totals. Do not promote if any validation returns false.

- [ ] **Step 6: Cross-check ASHK journal evidence**

Compare staging by exact `SaleId` for:

1. Шумилова Полина on 2 September;
2. three other active managers with payments;
3. at least one payment on a sale created before September, proving `SaleGet` fallback works.

For each sample, confirm staging `SaleEmployeeName` equals ASHK “Сотрудник, проводивший продажу”. Record only IDs, employee names, amounts, dates, and match status; do not record session data.

- [ ] **Step 7: Promote and verify the live ROP result**

Only when Steps 5–6 pass, run the existing intraday ROP refresh/publish flow. Verify:

- Shumilova’s personal fact equals the sum of September payment records whose `SaleId` belongs to her ASHK sales;
- an unresolved seller contributes to branch fact but not to any manager’s personal fact;
- branch plan/fact columns remain present;
- personal plan completion uses the corrected personal fact;
- weak/strong status coloring still renders in the published ROP sheet;
- hourly schedule remains in Tyumen time.

- [ ] **Step 8: Final verification and completion commit**

Run `npm test` again and check the deployed health/staging status once more. If implementation corrections were needed after the live probe, commit only those corrections:

```bash
git add \
  lib/ashk-web-session.js \
  lib/ashk-sale-attribution.js \
  api/sync-payments.js \
  lib/rop-daily-control.js \
  api/nightly-finance-orchestrator.js \
  test/ashk-web-session.test.js \
  test/ashk-sale-attribution.test.js \
  test/sync-payments-sale-attribution-wiring.test.js \
  test/rop-daily-control.test.js \
  test/rop-unmatched-diagnostics.test.js \
  test/nightly-rop-wiring.test.js
git commit -m "fix: verify ASHK seller attribution in production"
```

If no correction was needed, do not create an empty commit.
