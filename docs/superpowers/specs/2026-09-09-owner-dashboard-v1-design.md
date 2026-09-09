# Owner Dashboard v1 — design

## Status

Design approved in chat on 2026-09-09. This document defines the first owner-facing frontend layer over the accepted `ВЕКТОР — ФИНСИСТЕМА / API` v1 production core. The finance backend v1 remains frozen except for narrowly-scoped compatibility changes required by this dashboard and separately reviewed.

## Goal

Give the owner a mobile-first, read-only cockpit that answers in under 30 seconds:

1. How much money is available now?
2. Is there a cash gap in the next 7/14/30 days?
3. Are revenue, profit, sales, receivables and driving-fund economics on plan?
4. What obligations are due next?
5. What financial risks are active now?
6. What 3–7 actions require the owner's attention today?
7. Are the source systems and calculations healthy and current?

The dashboard is not a replacement for Google Sheets accounting. It is a decision surface over verified production facts.

## Non-goals

- No payments, transfers or other banking actions.
- No automatic classification of ambiguous Tochka transactions.
- No manual editing of DDS/P&L/obligations from the dashboard.
- No resurrection of closed decision risks just to make the interface visually busy.
- No broad refactor of the accepted v1 finance engine.
- No generic/public AI CFO product in this scope.

## Architecture

### Recommended approach: thin mobile-first web UI over the existing owner package

The accepted backend already exposes the owner-facing aggregate through `/api/owner-package` and protects it from unauthenticated access. The dashboard will consume that aggregate rather than independently re-reading Google Sheets, ASHK and Tochka from the browser.

Flow:

`Tochka + ASHK + cash + Sheets -> accepted finance backend -> owner-package -> dashboard view`

This keeps business logic and source reconciliation server-side and makes the frontend a presentation layer only.

### Alternatives considered

1. **Google Sheets-only dashboard.** Fastest, but the existing `Панель собственника` is stale and is not a reliable mobile owner experience.
2. **New independent frontend data layer.** Rejected for v1 because it would duplicate finance logic and create a second source of truth.
3. **Thin UI over owner-package.** Selected: smallest production change, clear boundary, easiest to test, and preserves the accepted core.

## Interface

### 1. Header / system state

Show:
- reporting timestamp and business date;
- production/data status;
- last successful refresh;
- compact warning when data is stale or a source is blocked.

A healthy system is visually quiet. Data-health warnings must be explicit and must never be hidden behind business KPIs.

### 2. Money now

Primary cards:
- total available cash;
- bank balance(s);
- cash desks;
- reserved/earmarked funds;
- truly free cash after protected reserves, when the backend supplies a verified number.

The UI must label scope and freshness. It must not invent a free-cash number from incomplete inputs.

### 3. Cash forecast

Show 7 / 14 / 30-day forecast:
- expected ending cash;
- minimum projected cash;
- first cash-gap date if any;
- size of the projected gap.

When current gap is zero, `DEC-CASH-GAP` must render as closed/inactive, not as a stale historical active risk.

### 4. Business performance

Show current-month:
- revenue fact;
- revenue forecast;
- operating profit;
- operating margin;
- contracts/sales fact vs plan;
- receivables;
- relevant direction/branch deviation when the source is verified.

The dashboard must distinguish cash movement (DDS) from economic result (P&L).

### 5. Driving fund

Show:
- required reserve;
- current fund balance;
- accrued/paid/remaining obligations when verified;
- fund deficit or surplus;
- cost per hour vs plan.

Business deficit is a business risk, not a software failure.

### 6. Obligations

Show the nearest verified obligations:
- counterparty/category;
- amount;
- due date;
- status (confirmed / unconfirmed / overdue where supported).

When unconfirmed obligation total is zero, `DEC-UNCONF-OBL` must be closed/inactive and must not retain a stale historical amount.

### 7. Decision Engine

Render current decisions from the accepted decision layer. Each item contains:
- decision/risk name;
- active/inactive state;
- verified amount or metric;
- concise reason;
- recommended owner response if supplied by the backend.

Closed decisions remain available only as secondary/history context, never mixed with active alerts.

### 8. Owner Action Queue

Primary operational block: the 3–7 highest-priority current actions.

Rules:
- READY/pending items are prominent;
- completed/closed items do not remain in the active queue;
- no synthetic tasks are generated client-side;
- ambiguous bank operations must explicitly stop at manual owner review.

### 9. Data Health

Show compact status for at least:
- Tochka -> DDS;
- ASHK payments/hours;
- decision reconcile / shadow;
- owner package freshness;
- cash/source freshness where available.

`BLOCKED` is a system/data issue. Business risks such as low sales, a fund deficit or a valid forecasted cash gap are not Data Health defects.

## Mobile-first UX

- First meaningful screen fits on a phone without horizontal scrolling.
- Money now, forecast, active risks and actions appear before diagnostic detail.
- Use cards for KPIs and short ranked lists for actions/risks.
- Detailed data can expand progressively; do not reproduce entire Sheets tables.
- Russian labels are the default owner-facing language.
- Desktop uses the same information hierarchy in a wider grid.

## Authentication and security

The existing owner package remains protected. The browser must not contain a permanent backend secret or service-account credential.

Implementation must choose a server-side/session-safe way to authorize dashboard reads. Unauthenticated owner-package access must continue to return `403` with `Cache-Control: no-store`.

No dashboard route may expose finance payloads through cacheable public responses.

## Data contract

The UI consumes only verified fields returned by the owner package (or a narrowly-added read-only dashboard projection built from the same verified owner-package source). Missing fields render as unavailable, not zero, unless the backend explicitly confirms zero.

Client-side code is not allowed to infer accounting classifications, compute unverified obligations, or promote staging data.

## Error handling

- Network/API failure: show last-known timestamp only if the payload is explicitly safe to retain; otherwise show unavailable.
- Stale data: show a visible stale badge with timestamp.
- Partial source failure: preserve healthy sections while clearly marking affected sections unavailable/blocked.
- Authentication failure: no finance data rendered.
- New ambiguous Tochka operation: surface a manual-review state only; do not classify it.

## Testing / acceptance

### Unit/contract tests

- dashboard projection handles verified zero vs missing correctly;
- stale closed decision risks do not render active;
- active queue excludes completed/closed artifacts;
- blocked Data Health renders distinctly from business risk;
- no finance payload is returned to unauthenticated callers;
- cache-control remains `no-store` for protected owner data.

### Production acceptance

Before merge/deploy:
- full existing backend suite remains green;
- new dashboard tests green;
- PR diff reviewed for no banking/classification side effects;
- pull_request merge-ref CI green;
- post-merge CI green;
- exact-SHA Vercel deployment READY;
- canonical health 200;
- unauthenticated owner package remains 403 + no-store;
- dashboard loads current accepted owner facts without stale active `DEC-CASH-GAP`/`DEC-UNCONF-OBL` artifacts;
- dashboard is usable on a phone viewport.

## Delivery slices

### Slice A — read-only dashboard shell

Implement mobile-first page, secure server-side owner-package read, KPI cards, active Decision Engine, Owner Action Queue and Data Health. This is the first shippable owner experience.

### Slice B — forecast and financial detail polish

Add verified 7/14/30-day forecast presentation, obligation detail, driving-fund breakdown and compact performance/branch drill-down when fields are already authoritative.

### Slice C — owner daily brief (post dashboard acceptance)

Generate a concise daily owner brief from the same accepted facts. This is delivery/notification work, not a reason to modify accounting logic.

## Definition of done for Owner Dashboard v1

The owner can open one protected mobile-friendly page and, from verified current production facts, understand cash position, forecast, active business risks, obligations, owner actions and data health without opening the underlying accounting sheets. No action on the page can move money or classify an ambiguous transaction.
