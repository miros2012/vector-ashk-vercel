# Finance Stage Retry Ledger Design

## Goal

Make finance synchronization recover from one transient stage failure without rerunning unrelated successful work, while preserving fail-closed accounting and an auditable history of every stage attempt.

## Production evidence

On 17 September 2026 the receivables staging contained a valid readback of 190 contracts and 3,604,899 RUB debt. A 15:36 UTC run completed and advanced `receivables_last_success_utc`; a 15:47 UTC run returned HTTP 500 from the combined receivables handler. The handler currently wraps ASHK fetch, two Sheets writes, readback, ROP source rebuild, standalone ROP publication, and the success-marker write in one `try/catch`, then logs only the JavaScript error name. Therefore the exact failed boundary cannot be recovered from production telemetry, and a downstream ROP failure can falsely mark the receivables source as failed.

## Chosen approach

Use the existing Vercel runtime and Google Sheets book. Add no queue service, database, paid infrastructure, or new financial writer. Persist a compact retry state in `__vercel_control` and append sanitized attempt history to a new hidden sheet named `Finance Run Ledger`.

Rejected alternatives:

- Retrying the full orchestration inside the same request can exceed the 180-second function budget and duplicates successful writes.
- Vercel Workflow or Queues would add infrastructure and operating cost before the current volume requires it.

## Stage boundaries

The current combined receivables operation becomes two explicit idempotent stages.

### `receivablesSource`

1. Fetch current ASHK groups and contracts.
2. Build receivables detail and summary.
3. Replace the two staging ranges.
4. Read both ranges back and verify exact aggregate counts and amounts.
5. Rebuild current-month contract staging from the same fetched ASHK payload,
   replace its range, and verify every staged value by readback. This includes
   fully paid contracts omitted from the positive-debt receivables detail.
6. Advance `receivables_last_success_utc` only after all three source ranges are verified.

This stage does not rebuild or publish ROP.

### `ropPublish`

1. Read already verified payments, contracts, and receivables staging.
2. Rebuild ROP outputs.
3. Publish and verify the standalone ROP workbook.

Failure of this stage does not invalidate the receivables source marker.

Other finance stages retain their existing behavior in this package. The ledger interface is generic, but automatic durable retry is enabled only for `receivablesSource` and `ropPublish` until production evidence justifies adding another stage.

## Safe failure contract

Every stage result has this public shape:

```js
{
  ok: false,
  statusCode: 502,
  errorClass: 'ASHK_FETCH',
  retryable: true
}
```

Allowed error classes are:

- `ASHK_FETCH`: upstream network, timeout, 429, or 5xx exhausted after the source's bounded request retry.
- `SHEETS_WRITE`: bounded Google Sheets write failed.
- `SHEETS_READBACK`: bounded Google Sheets read failed.
- `READBACK_MISMATCH`: written aggregates differ from source; never auto-retry in this package.
- `ROP_BUILD`: deterministic ROP reconstruction failed; never auto-retry.
- `ROP_PUBLISH`: standalone publication or its readback failed.
- `TIME_BUDGET`: the stage cannot safely start or retry within the remaining function budget.
- `LEDGER_WRITE`: the sanitized attempt row could not be appended or verified; never causes the financial stage itself to run again.
- `UNCLASSIFIED`: safe fallback with no original message exposed.

`ASHK_FETCH`, `SHEETS_WRITE`, `SHEETS_READBACK`, `ROP_PUBLISH`, and `TIME_BUDGET` are retryable. `READBACK_MISMATCH`, `ROP_BUILD`, `LEDGER_WRITE`, authentication or validation failures, and `UNCLASSIFIED` are permanent for automatic-retry purposes.

Controlled stages check the 180-second route budget before starting execution. The
request start is captured before lazy Google initialization or manual-token
consumption. `FINANCE_STAGE_MIN_REMAINING_MS` configures the minimum remaining
budget; unset/invalid values use a conservative 90,000 ms default. Positive values
up to 180,000 ms are accepted. A late stage records and schedules `TIME_BUDGET`
without invoking its executor, leaving the remaining time for durable control
writes and lease release. This is a start guard, not cancellation of in-flight I/O.

Logs may contain the stage, class, attempt, and retryable flag. They must not contain API keys, student names, contract rows, payment rows, raw provider bodies, or arbitrary exception messages.

## Run identity and ledger

Each orchestrator invocation creates a run ID using the UTC start timestamp plus random bytes. A stage attempt key is `runId:stage:attempt`.

The hidden `Finance Run Ledger` sheet has one header row and these columns:

1. `runId`
2. `startedAtUtc`
3. `finishedAtUtc`
4. `trigger`
5. `mode`
6. `stage`
7. `attempt`
8. `result`
9. `statusCode`
10. `errorClass`
11. `retryable`
12. `retryAfterUtc`
13. `deploymentSha`

`result` is one of `SUCCESS`, `FAILED`, `SKIPPED`, or `RECOVERED`. The adapter appends exactly one row per attempt and verifies the attempt key is unique after write. No financial values or personal data are stored.

## Durable retry state

The following keys live in `__vercel_control`:

- `finance_retry_stage`
- `finance_retry_attempt`
- `finance_retry_after_utc`
- `finance_retry_origin_run_id`
- `finance_retry_error_class`

Only one pending retry is supported. This matches the single sequential finance orchestrator and prevents competing recovery work. Writes use exact key rows and readback verification.

Retry policy:

- Attempt 1 failure schedules attempt 2 after 10 minutes.
- Attempt 2 failure schedules attempt 3 after 30 minutes.
- Attempt 3 failure remains visible as failed and clears automatic retry state; Data Health and the morning finance report continue to expose stale-source risk.
- `READBACK_MISMATCH`, `ROP_BUILD`, authentication failures, validation errors, and `UNCLASSIFIED` are not automatically retried.

## Recovery flow

At the beginning of a cron or protected manual invocation:

1. Read pending retry state.
2. If no retry is due, run the normal finance cycle.
3. If a retry is due, run only the stored stage.
4. On `receivablesSource` recovery, run `ropPublish`, Data Health, and Decision Engine; do not rerun hours, payments, Tochka import, or balances. Run Owner Action processing only when the active orchestration mode already includes it.
5. On `ropPublish` recovery, run Data Health and Decision Engine, plus Owner Action processing only in the existing intraday mode.
6. Clear retry state only after the retried stage succeeds and its ledger row is verified.
7. A failed Data Health check still blocks Decision Engine and financial actions.

The HTTP response remains non-2xx whenever any stage in the current invocation fails, even if safe downstream diagnostic stages complete.

Ledger failure is reported separately as `LEDGER_WRITE`. It must not undo a verified source write or cause that financial stage to run twice. Automatic retry is disabled for an invocation whose outcome could not be recorded, while Data Health may still evaluate the verified source markers.

## Concurrency and idempotency

The finance route acquires a `finance_orchestrator_lock` lease in `__vercel_control` before reading retry state. The lease expires after four minutes and is released in `finally`. A concurrent cron or manual run returns HTTP 409 with no stage work.

Receivables staging writes replace deterministic ranges and verify aggregates. ROP publication already uses verified source-to-target publishing. Ledger uniqueness prevents duplicate attempt records after transport retries.

## Testing

Tests must prove:

- receivables success advances its marker before ROP publication;
- ROP failure cannot turn a verified receivables source into a failed source stage;
- each allowed safe error class is emitted without raw exception text;
- transient failures schedule attempts 2 and 3 with 10- and 30-minute delays;
- permanent failures never schedule a retry;
- recovery runs only the failed stage and required downstream stages;
- Data Health failure still blocks decisions during recovery;
- a concurrent invocation performs no work;
- ledger rows are unique and contain no business payload;
- all existing finance orchestration and source-sync tests remain green.

## Production acceptance

1. Provision the hidden ledger sheet and exact control keys.
2. Deploy through a tested PR.
3. Run one protected production cycle.
4. Verify distinct `receivablesSource` and `ropPublish` ledger rows.
5. Verify `receivables_last_success_utc` advances after staging readback.
6. Verify Data Health uses the source marker and still blocks unsafe decisions.
7. Trigger a test-only injected transient failure in unit/integration tests only; do not intentionally corrupt or fail production financial data.
8. Confirm no payments, transfers, bank-operation changes, or ambiguous classifications occurred.
