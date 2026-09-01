# Decision Reconciliation Design

## Goal

Make backend Decision Engine state refresh automatically after real financial-source changes while preserving the current Google Sheets formulas as a reversible safety net until cutover is explicitly enabled.

## Approved architecture

Use a hybrid event-driven + daily reconciliation model suitable for the current Vercel Hobby plan.

1. Event-driven path: after a real live financial source successfully writes new facts to Google Sheets, the same backend invocation runs Decision Engine reconciliation. The first event hook is `api/balances.js` immediately after a successful Tochka live-balance mirror.
2. Daily safety path: one Vercel Cron invokes a protected reconciliation route once per day. This covers date changes, manual sheet edits, and missed source events.
3. Reuse the existing `createDecisionStateSynchronizer()` for both paths. It remains dry-run by default and can only write when `DECISION_STATE_WRITES_ENABLED === 'true'`.
4. Any commit-mode synchronization keeps the existing formula backup, atomic H/J/M/P write, post-write shadow verification, and rollback behavior.
5. `sync-payments` and `sync-hours` are not Decision Engine triggers yet because they currently write staging/reconciliation data rather than canonical live financial facts.

## Data flow

### Event hook

Tochka webhook → Render bridge → `/api/balances` → mirror 5 balances to `Точка_Остатки` → run decision reconciliation → return balance response with aggregate reconciliation status.

A failed Decision Engine reconciliation must not roll back a successful bank-balance mirror. It is an observability/control failure, not a bank-data failure. The balance endpoint returns the live balance success plus a non-sensitive reconciliation status and logs the error.

### Daily safety reconciliation

Vercel Cron → `/api/decision-reconcile-daily` → verify `Authorization: Bearer ${CRON_SECRET}` → run the same reconciliation service → return aggregate status only.

On Hobby there is exactly one daily cron definition.

## Modes

- `DECISION_STATE_WRITES_ENABLED !== 'true'`: shadow/dry-run only. No formulas or decision-state cells are replaced.
- `DECISION_STATE_WRITES_ENABLED === 'true'`: synchronizer may write H/J/M/P, with formula backup, atomic write, post-write 4/4 verification, and rollback on any failure.

## Components

- `lib/decision-reconciliation.js`: composition service that owns when/how to call the existing state synchronizer and normalizes a non-sensitive result.
- `api/balances.js`: calls reconciliation only after successful `mirrorToGoogleSheet()`; cached balance responses do not reconcile because no financial fact changed.
- `api/decision-reconcile-daily.js`: protected Vercel Cron route using the same composition service.
- `vercel.json`: one daily cron definition.

## Security

- Cron route requires `CRON_SECRET` bearer authentication.
- Cron and balance responses expose only aggregate fields (`ok`, `mode`, `verified`, `matches`, `total`, `writeCount`) and never mismatch details, rule IDs, amounts, linked objects, or sheet contents.
- Shadow reads use the existing financial snapshot adapter. Commit mode uses the existing write-capable Sheets client only inside backend code.

## Failure behavior

- Balance mirror succeeds but reconciliation fails: bank balance remains current; endpoint reports reconciliation `ok:false` without exposing internals; server logs contain the internal error.
- Daily reconciliation fails: route returns 500 with generic error and logs details.
- Commit write fails or post-write shadow drifts: existing rollback logic restores formula backup; result is failure, never success.

## Cutover gate

Scheduler/event hooks are first deployed with writes disabled. Enable backend ownership only after:

1. event-hook dry-run is observed on a real balance update;
2. daily reconciliation dry-run is successful;
3. production shadow remains 4/4 with drift 0;
4. full repository test suite is green.

Only then may `DECISION_STATE_WRITES_ENABLED=true` be enabled separately. Execution Layer columns and history remain outside this cutover.
