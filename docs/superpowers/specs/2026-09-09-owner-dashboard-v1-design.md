# Owner Dashboard v1 — design

## Status

Direction approved in chat on 2026-09-09; this written spec is pending final owner review before implementation. It defines the first owner-facing web layer over the accepted `ВЕКТОР — ФИНСИСТЕМА / API` v1 production core.

The finance backend v1 remains frozen. The dashboard may reuse its read-only libraries and source contracts but must not change banking behavior, Tochka classification behavior, DDS writes, obligation writes, decision semantics, or the accepted owner-package contract.

## Goal

Give the owner a mobile-first, read-only cockpit that answers in under 30 seconds:

1. How much money is available now?
2. Is there a cash gap over the 30-day forecast, and what does the next 7/14/30-day path look like?
3. Are sales/collections, receivables, obligations and driving-fund protection on plan?
4. Which current risks/actions require attention?
5. Are the source systems and calculations healthy and current?

The dashboard is not a replacement for Google Sheets accounting. It is a decision surface over verified production facts.

## Existing production assets to reuse

The accepted `main` already contains:

- `/api/owner-package` as a rewrite to the existing `api/decision-event.js` owner-package route;
- read-only Google Sheets access for the owner package;
- `lib/owner-live-source-reader.js`;
- `lib/owner-live-package-service.js`;
- `lib/owner-dashboard-snapshot.js`;
- configured 30-day cash scenarios;
- owner agenda/action logic;
- decision verification queue;
- canonical Data Health integration;
- `Cache-Control: no-store` and key authentication on the owner package.

The dashboard must consume these accepted facts rather than create a second finance model.

## Non-goals

- No payments, transfers or other banking actions.
- No automatic classification of ambiguous Tochka transactions.
- No manual editing of DDS/P&L/obligations from the dashboard.
- No resurrection of closed decision risks.
- No broad refactor of the accepted v1 finance engine.
- No generic/public AI CFO product in this scope.
- No new accounting calculations merely to fill empty visual cards.

## Approaches considered

### A. Google Sheets-only dashboard

Fastest, but the current `Панель собственника` is stale and is not a reliable mobile owner experience. Rejected as the final interface.

### B. Separate frontend with its own data layer

Would duplicate source reads and finance logic. Rejected because it creates a second source of truth.

### C. Thin web UI over accepted owner-package facts — selected

Add a small mobile-first web layer in the same Vercel project. It uses the existing read-only source reader/package builder and adds only presentation/session plumbing. This is the smallest production change and keeps all accounting decisions server-side.

Flow:

`Tochka + ASHK + cash + Sheets -> accepted read-only owner package -> dashboard data facade -> mobile UI`

## Implementation boundary

The first implementation slice adds new files only except for the smallest Vercel routing/static-hosting adjustment if required.

Planned units:

- `public/owner/index.html` — static owner UI shell and login state; contains no finance data or secret.
- `public/owner/app.js` — display-only browser logic.
- `public/owner/styles.css` — mobile-first Vector visual system (black/red/white/gray).
- `lib/owner-dashboard-session.js` — password verification, HMAC-signed expiring session token and cookie helpers using Node `crypto`; no external dependency.
- `lib/owner-dashboard-view-model.js` — presentation-only projection from the accepted immutable owner package; no accounting classification or source mutation.
- `api/owner-dashboard-session.js` — login/status/logout endpoint; always `no-store`.
- `api/owner-dashboard-data.js` — authenticated GET-only endpoint that performs the same bounded read-only owner source/package build and returns the display view model; always `no-store`.
- corresponding `test/*.test.js` contract/unit tests.

`api/decision-event.js`, the existing `/api/owner-package` route and finance write paths remain unchanged in Slice A.

## Authentication and security

### Selected model

Use one dedicated Vercel environment secret: `VECTOR_OWNER_DASHBOARD_SECRET`.

Login flow:

1. User opens `/owner/`; static HTML contains no finance data.
2. User enters the dashboard password over HTTPS.
3. `POST /api/owner-dashboard-session` compares it in constant time with `VECTOR_OWNER_DASHBOARD_SECRET`.
4. On success, server returns an HMAC-signed opaque session token in cookie `__Host-vector_owner`.
5. Cookie properties: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, finite max age.
6. Browser JavaScript never receives or stores the secret.
7. `GET /api/owner-dashboard-data` validates the signed session cookie before any finance read.
8. Logout deletes the cookie.

The session payload contains only version/expiry metadata; no finance data and no password. The signature uses HMAC-SHA256 with `VECTOR_OWNER_DASHBOARD_SECRET`.

Unauthenticated or invalid-session dashboard-data requests return `403` and no finance payload. All session and finance responses use `Cache-Control: no-store`.

The existing `/api/owner-package` authentication remains unchanged and must continue to return `403 + no-store` when unauthenticated.

## Data contract

The dashboard view model is a presentation projection of the existing immutable owner package. It may format or summarize verified values, but it cannot create new accounting truth.

### Slice A authoritative fields

From `snapshot`:

- business date and generated timestamp;
- available cash;
- cash gap;
- safe withdrawal (including explicit policy-blocked zero);
- sales plan to date and sales fact;
- receivables;
- open obligations;
- unconfirmed obligations;
- driving-fund reserve;
- driving-fund deficit;
- Data Health status/reasons;
- current owner actions.

From `cashScenario`:

- base/conservative/target scenario paths;
- base scenario daily closing balances;
- minimum balance/date;
- current cash gap/required collection.

The 7/14/30-day labels are summaries of the accepted base daily forecast; they are presentation summaries, not a new forecast engine.

From `agenda` and `verificationQueue`:

- current priority owner actions;
- pending/overdue decision verification facts.

### Missing data rule

Missing or unsupported values render as `Нет подтверждённых данных`, not `0`. Zero is displayed only when the backend explicitly supplies a verified zero.

P&L/profit cards are not included in Slice A because the accepted owner package does not currently expose an authoritative P&L value. They may be added later only after a verified source contract is defined; no number will be guessed from DDS or sales.

## Interface

### 1. Header / system state

Show:
- `ВЕКТОР — Финштаб собственника`;
- business date;
- generated timestamp;
- Data Health state;
- visible stale/blocked warning when applicable.

Healthy status is visually quiet; blocked/stale facts are explicit.

### 2. Money now

Primary cards:
- `Доступно сейчас`;
- `Безопасно вывести`;
- `Кассовый разрыв`.

If withdrawal is blocked by policy, show the actual verified zero plus the policy blocker reason rather than implying that zero is a business recommendation.

### 3. Forecast 7/14/30

Show base-scenario closing balance at the nearest available day 7, 14 and 30, plus:
- minimum projected balance;
- minimum-balance date;
- cash gap / required collection if positive.

Do not generate forecasts beyond the accepted source horizon.

### 4. Sales and receivables

Show:
- plan to date;
- fact to date;
- deficit/surplus to plan as a presentation difference;
- receivables.

### 5. Driving fund

Show:
- required reserve;
- deficit/surplus from the authoritative package.

Business deficit is a business risk, not a software failure.

### 6. Obligations

Show aggregate:
- open obligations;
- unconfirmed obligations.

Detailed counterparty rows are deferred until the existing owner package exposes a verified detail contract; the UI must not re-read arbitrary sheet ranges just for display.

### 7. Risks / Decision verification

Show pending and overdue verification from the accepted verification queue. Closed historical risks do not appear as active alerts.

When current cash gap is zero, no stale historical `DEC-CASH-GAP` amount may be shown as active. When unconfirmed obligations are zero, no stale historical `DEC-UNCONF-OBL` amount may be shown as active.

### 8. Owner Action Queue

Primary operational block: up to the highest-priority 3–7 current actions from the accepted agenda.

Rules:
- current selected actions are prominent;
- no client-generated tasks;
- no payment/transfer button;
- any ambiguous bank operation remains manual-review-only and is never classified by the UI.

### 9. Data Health

Show canonical Data Health status and supplied reasons. Do not reinterpret low sales, fund deficit or a valid forecasted cash gap as a software/data defect.

## Mobile-first UX

- First meaningful screen fits an iPhone viewport without horizontal scrolling.
- Money, forecast, active actions/risks appear before diagnostics.
- Cards for KPIs; short ranked lists for actions/verification.
- Russian owner-facing labels.
- Desktop reflows to a wider grid without changing information hierarchy.
- No heavy frontend framework is introduced for Slice A; the current repository is Node serverless with no frontend build system, so plain HTML/CSS/ES modules minimize deployment risk.
- Vector visual system: black/white/gray base, red only for priority/risk/accent states.

## Error handling

- Authentication failure: render login/forbidden state, no finance payload.
- Package/source failure: render `Данные временно недоступны`; do not display zeros as fallback.
- Data Health `BLOCKED`: show package facts only if the accepted owner package itself returned them; clearly display the blocker.
- Stale source warning: display supplied warning/reason and generated timestamp.
- New ambiguous Tochka operation: surface only the existing manual-review signal if present; do not classify it.
- Browser must not persist finance payload to `localStorage` or IndexedDB.

## Testing / acceptance

### Session/security tests

- wrong password rejected;
- missing dashboard secret fails closed;
- signed session accepted;
- expired/tampered token rejected;
- cookie has `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`;
- authenticated data endpoint returns `no-store`;
- unauthenticated data endpoint is `403` with no package;
- existing unauthenticated `/api/owner-package` remains `403 + no-store`.

### View-model tests

- verified zero is preserved as zero;
- missing value renders unavailable rather than zero;
- base 7/14/30 summaries are deterministic from supplied daily forecast;
- policy-blocked safe withdrawal is explained;
- active agenda only uses supplied accepted actions;
- no stale closed cash-gap/unconfirmed-obligation amount is promoted to active display;
- Data Health `BLOCKED` is visually/data-contract distinct from business-risk values.

### Regression tests

- full existing backend suite remains green;
- no new code path calls Tochka mutation, bank payment/transfer, DDS write or classification action;
- `api/decision-event.js` and accepted owner-package contract remain unchanged in Slice A.

### Production acceptance

Before declaring Owner Dashboard v1 accepted:

- PR diff reviewed for no banking/classification side effects;
- pull_request merge-ref CI green;
- post-merge CI green;
- exact-SHA Vercel deployment READY;
- canonical `/api/health` = 200;
- unauthenticated `/api/owner-package` = 403 + no-store;
- unauthenticated `/api/owner-dashboard-data` = 403 + no-store;
- authenticated `/owner/` loads current owner facts;
- phone-width browser verification shows no horizontal overflow and the primary cards/actions are readable;
- no stale active `DEC-CASH-GAP`/`DEC-UNCONF-OBL` amount is displayed;
- no new ambiguous Tochka operation is auto-classified.

## Delivery slices

### Slice A — usable protected dashboard

Ship secure login/session, mobile UI, money, 7/14/30 base forecast, sales/receivables, driving-fund protection, obligations aggregates, action agenda, verification and Data Health.

### Slice B — verified detail extensions

Only after Slice A acceptance: add detailed obligations, richer branch/performance views and P&L/profit if an authoritative owner-package source contract is explicitly defined.

### Slice C — daily owner brief

Only after dashboard acceptance: deliver a concise daily owner brief from the same accepted facts. This is delivery/notification work, not accounting logic.

## Definition of done for Owner Dashboard v1

The owner can open one protected mobile-friendly page and understand current cash position, forecast, sales gap, receivables, obligations exposure, driving-fund protection, active owner actions, verification workload and Data Health without opening the underlying accounting sheets. No action on the page can move money or classify an ambiguous transaction.

## Implementation adaptation — 2026-09-12
User authorized implementation. Keep the 12-function deployment footprint by dispatching dashboard session/data through decision-event ownerRoute. Authentication remains separate, fail-closed with VECTOR_OWNER_DASHBOARD_SECRET (minimum 32 characters). No finance calculations or writes added.
