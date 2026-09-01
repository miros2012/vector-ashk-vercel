# Nightly Finance Orchestrator Design

## Goal

Keep Vercel Hobby compatible with exactly one daily cron while preserving independent protected HOURS and decision-reconciliation routes.

## Schedule

The single production cron runs at `30 21 * * *` UTC, which is 02:30 in `Asia/Yekaterinburg`.

## Execution order

One protected orchestrator invocation performs these stages sequentially:

1. Run the ASHK HOURS nightly sync.
2. On Tyumen days 1–3, HOURS first archives the previous month to `АШК_Часы_Табель__vercel__YYYY-MM` and matching reconciliation archive, then refreshes the current month staging.
3. Require HOURS source↔staging verification to succeed before continuing.
4. Run decision reconciliation after HOURS completes.
5. Return only aggregate, non-secret stage results.

A failed HOURS stage prevents decision reconciliation in that invocation. A failed decision stage does not roll back already verified HOURS staging, but the orchestrator returns a non-2xx result so operations can investigate.

## Route boundaries

- `/api/sync-hours` remains the HOURS implementation and supports protected cron GET plus existing manual POST auth.
- `/api/decision-reconcile-daily` remains the decision reconciliation implementation and remains independently protected.
- `/api/nightly-finance-orchestrator` is the only route registered in `vercel.json` cron configuration.

The orchestrator never embeds, logs, returns, or accepts the value of `CRON_SECRET`. It invokes the two handlers internally using the runtime `CRON_SECRET` as an Authorization bearer value.

## Deployment constraints

- Vercel Hobby: exactly one daily cron.
- Business timezone: `Asia/Yekaterinburg`.
- Cron schedule: `30 21 * * *` UTC / 02:30 Tyumen.
- No production changes to master rates, `Фонд вождения`, or canonical payroll calculations as part of this release.
- Feature branch must be synchronized with current `main` before final verification and merge.

## Verification gates

Before production merge:

1. Full Node test suite: zero failures.
2. Fresh Preview deployment with Preview `CRON_SECRET` available.
3. Authenticated HOURS staging run returns HTTP 200 and `comparison.ok=true`.
4. On Sep 1–3 verification, August archive and September current staging both reconcile independently.
5. Orchestrator tests prove order: HOURS first, decisions second; decisions are skipped when HOURS fails.
6. PR is not behind `main` at release time.

After production merge:

1. Production deployment reaches READY.
2. Exactly one Vercel cron exists, pointing to `/api/nightly-finance-orchestrator` at `30 21 * * *`.
3. Production smoke checks remain healthy.
4. First scheduled run is verified from runtime logs and Google Sheets reconciliation state.
