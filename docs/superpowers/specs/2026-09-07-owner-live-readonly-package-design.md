# Owner Live Readonly Package Design

## Goal

Expose one protected, read-only Owner API package built from current Vektor financial facts without creating a second financial model, without writing to Google Sheets, and without weakening existing fail-closed controls.

The package must combine live liquidity, 30-day forecast, sales/collections, receivables, obligations, driving-fund protection, Data Health, owner actions, and decision-effect verification into the existing `buildOwnerReadonlyPackage` / Owner Dashboard model.

## Approved safety rule

The operating reserve policy is not yet defined. This must **not** make the whole Owner API unavailable, and it must **not** be silently interpreted as `0 ₽` or any guessed reserve.

Until a separate operating-reserve rule is approved:

- the Owner API still returns the live package;
- `safeWithdrawal` is forced to `0 ₽`;
- the withdrawal section exposes an explicit policy blocker code `OPERATING_RESERVE_UNDEFINED`;
- Data Health continues to represent source/accounting integrity only and is not falsified to simulate a policy blocker;
- no financial execution action becomes executable merely because the operating reserve is missing.

Policy incompleteness and source-data health are separate concepts.

## Source-of-truth boundaries

All production reads use Google Sheets read-only scope and `UNFORMATTED_VALUE` for financial values.

### 30-day forecast

Use the existing `owner-forecast-sheet-adapter` and exactly:

`'Прогноз 30 дней'!A1:R34`

This supplies actual available cash, projected opening cash, dated inflows, dated outflows, and dated protected reserves. Rows below 34 are unrelated control blocks and must not be included.

### Data Health

Read the bounded `Data Health Snapshot` contract and reuse the canonical Data Health parser/evaluator rather than creating another health rule set.

The package must preserve the distinction between:

- source freshness;
- accounting coverage;
- manual Tochka → DDS backlog;
- warnings/review items;
- hard financial blockers.

The existing manual Tochka → DDS operations remain untouched and unclassified.

### Sales and collections

Use the current `РОП_Штаб_Утро` city row for sales plan-to-date and sales fact. Select the row mechanically by the current business date, slice `СЕГОДНЯ — НА СЕЙЧАС`, and level `ГОРОД`; do not depend on a fixed physical row number.

Receivables do **not** come from that ROP row. Use the canonical `АШК_Дебиторка_Свод__vercel` total instead. If duplicate source surfaces disagree, do not average, merge, or silently pick a convenient value.

### Obligations

Use `Обязательства` plus `Корректировки обязательств` through existing obligation semantics. Paid obligations and zero-cash-outflow reserve rows must not be counted as open cash needs. Do not double-count obligations already represented by the driving-fund reserve or forecast protection logic.

### Driving fund

Read `Фонд вождения` by exact business labels, not hard-coded row numbers, and expose at minimum:

- required driving-fund reserve;
- live driving-fund balance;
- positive deficit / negative surplus.

The current simplified driving-fund model remains authoritative; this work does not change master rates, hours, fuel, leasing, or the model formula.

### Decisions and verification

Reuse the existing `Решения` / `История решений` lifecycle and verification queue. Synthetic decisions remain excluded from owner effectiveness and action logic.

## Composition architecture

The implementation is split into three bounded layers.

### Layer 1 — live source reader

Create one read-only source adapter/service that gathers the minimum bounded ranges and returns a normalized `owner live facts` object.

Responsibilities:

- perform bounded Google Sheets reads only;
- delegate forecast parsing to the existing forecast adapter/parser;
- reuse existing decision/verification and Data Health semantics wherever already implemented;
- parse label-based source facts deterministically;
- reject missing, malformed, duplicated, or conflicting required facts;
- never calculate business recommendations itself;
- never mutate the source matrices.

### Layer 2 — package composition and withdrawal policy gate

Create a composition service that turns normalized live facts into the inputs expected by the existing owner cores.

Responsibilities:

- run the configured three-scenario cash forecast using the owner-approved cash policy;
- build owner agenda candidates only from supplied live facts and existing supported categories;
- build the decision verification queue from the real decision lifecycle;
- build the immutable Owner Dashboard snapshot;
- apply Data Health fail-closed behavior to financial execution actions;
- apply the separate operating-reserve policy gate.

The operating-reserve gate must short-circuit only the withdrawal recommendation. It must not invent a numeric reserve, must not rewrite Data Health, and must return `safeWithdrawal = 0` with `OPERATING_RESERVE_UNDEFINED` until a real reserve rule exists.

When the operating reserve is later approved, the gate can switch to the ordinary safe-withdrawal calculation without changing source contracts or the API shape.

### Layer 3 — protected API wiring

Expose the package through the existing `api/decision-event.js` serverless function using a new `ownerRoute=package` dispatch and a friendly rewrite such as `/api/owner-package`.

Requirements:

- GET only;
- existing owner key authentication (`x-vector-key` or Bearer) reused;
- Google Sheets client uses read-only scope;
- `Cache-Control: no-store`;
- no new serverless function;
- no new cron;
- no bank write path;
- no Sheets write path;
- no DDS, obligation, or Tochka classification mutation.

## Owner package behavior

A successful response returns the existing immutable owner package shape plus explicit policy-completeness information required to explain a zero withdrawal.

The package remains useful even when withdrawals are blocked. It may still show:

- current cash;
- cash-gap forecast;
- sales plan/fact and collection deficit;
- receivables;
- open obligations;
- driving-fund reserve and deficit;
- Data Health state and reasons;
- top owner actions;
- pending and overdue decision-effect verification.

Financial execution actions remain non-executable when canonical Data Health is blocked.

## Failure behavior

### Return package with safe withdrawal zero

Return HTTP 200 with a complete package when all required source data is valid but withdrawal is blocked by an explicit policy condition such as `OPERATING_RESERVE_UNDEFINED`.

### Fail closed

Return the existing generic owner-package failure if a required source is unavailable, malformed, ambiguous, internally conflicting, or cannot be safely normalized.

Do not return a partial package that could look financially authoritative.

## Implementation sequence

### PR A — live source contracts

Add the read-only owner live source adapter and tests for exact bounded reads, source selection, conflict detection, fail-closed parsing, and input immutability.

No API or business-policy change in this PR.

### PR B — live package service and operating-reserve gate

Compose the normalized facts into scenario forecast, safe-withdrawal result, agenda, verification queue, and snapshot.

Tests must prove:

- undefined operating reserve returns `safeWithdrawal = 0` plus `OPERATING_RESERVE_UNDEFINED`;
- Data Health is not rewritten just to block withdrawal;
- existing Data Health blockers still force financial actions fail-closed;
- no guessed operating reserve enters calculations or output;
- existing approved behavior remains unchanged when an explicit operating reserve is supplied in tests.

### PR C — production read-only route

Wire the service into `api/decision-event.js`, add the rewrite, retain the current function-count ceiling, and verify GET/auth/no-store/read-only behavior.

## Non-goals

This release does not:

- define the operating reserve amount or formula;
- classify the outstanding manual Tochka → DDS operations;
- change the driving-fund business model;
- change master payroll or rates;
- make payments or bank transfers;
- write to DDS, obligations, decisions, or financial registers;
- replace the existing Owner Action execution lifecycle;
- create a separate public AI CFO product.

## Verification gates

For each implementation PR:

1. RED/GREEN TDD for new behavior.
2. Full `npm test` with zero failures.
3. API syntax check with zero failures.
4. Changed-file review against the PR allowlist.
5. No new Sheets write call in the read-only package path.
6. No bank mutation, DDS classification, or obligation mutation.

Before declaring the live Owner API complete:

1. all three implementation PRs are merged;
2. post-merge CI on `main` is green;
3. production deployment is READY;
4. authenticated production GET returns the package with `Cache-Control: no-store`;
5. live package uses current source facts;
6. while the operating reserve remains undefined, production `safeWithdrawal` is exactly `0` with blocker `OPERATING_RESERVE_UNDEFINED`;
7. manual Tochka → DDS backlog remains untouched and continues to block financial execution according to canonical Data Health.
