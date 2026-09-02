# Vector AШК backend — Vercel pilot

Safe backend/staging layer for the Vector finance system.

## Existing integrations

- `GET /api/health` — checks presence of required secrets.
- `POST /api/sync-payments` — fetches current-month AШК payments and writes only to staging `АШК_Оплаты__vercel`, then compares with the live payments sheet.
- Nightly ASHK hours ingestion archives/refreshes verified work events in business timezone `Asia/Yekaterinburg`.
- Production finance writes remain explicitly gated; staging calculations must not silently promote values downstream.

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
