# Vector AШК backend — Vercel pilot

Safe backend/staging layer for the Vector finance system.

## Existing integrations

- `GET /api/health` — checks presence of required secrets.
- `POST /api/sync-payments` — fetches current-month AШК payments and writes only to staging `АШК_Оплаты__vercel`, then compares with the live payments sheet.
- Nightly ASHK hours ingestion archives/refreshes verified work events in business timezone `Asia/Yekaterinburg`.
- Production finance writes remain explicitly gated; staging calculations must not silently promote values downstream.

## Guarded hourly project continuation

The repository includes a fail-closed hourly development loop. It only processes owner-authored GitHub issues whose title begins with `[agent-ready]` and whose body contains an explicit JSON allowlist of one to six files under `lib/`, `test/`, or `docs/`.

The workflow uses a short-lived GitHub Actions OIDC token to request a bounded full-file proposal through the existing `/api/health` function and Vercel AI Gateway. It applies the proposal only to a new feature branch, runs syntax checks and the complete test suite, and opens a draft pull request. It never merges automatically and cannot modify API routes, workflows, scripts, package/config files, secrets, production financial data, payment classifications, or inferred business facts.

Issue configuration example:

```text
[agent-ready] Add a pure validation helper

Describe the bounded task and acceptance criteria.

<!-- hourly-agent
{"allowedFiles":["lib/example.js","test/example.test.js"]}
-->
```

If no eligible issue exists, another agent pull request is already open, OIDC validation fails, Vercel OIDC is unavailable, the proposal escapes the allowlist, or verification fails twice, the workflow stops without creating or merging code.

## Verified master payroll domain

The payroll modules are deliberately route-free and do not write `Фонд вождения`:

- `lib/master-payroll-gross.js` — calculates verified gross from ASHK work events using owner-confirmed rate units.
- `lib/master-payroll-evidence.js` — accepts only individually attributable payroll payments/deductions; fuel/leasing without authoritative master allocation is blocked.
- `lib/master-payroll-reconciliation.js` — calculates outstanding net and explicit promotion gates.
- `lib/master-payroll-sheet-adapter.js` — renders a deterministic staging matrix only.

August 2026 regression controls are locked in `test/fixtures/master-payroll-august-2026.json`. The approved lesson/event rule is authoritative: lesson-priced work is paid by event count while academic hours remain a control signal.

Design: `docs/superpowers/specs/2026-09-02-master-payroll-verified-gross-net-design.md`.

## Environment

Required Vercel environment variables include:
- `ASHK_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

The Google service account must have Editor access to the finance spreadsheet.
