# ASHK Hours Automatic Sync Design

**Goal:** Make `MasterWorkReportDetails` the single authoritative source of instructor hours, normalize business dates in `Asia/Yekaterinburg`, publish an idempotent raw ledger to Google Sheets, and continuously reconcile the imported ledger.

## Architecture

`api/sync-hours.js` remains the only external integration point for ASHK hours. It requests a bounded period from `MasterWorkReportDetails`, passes rows to pure normalization/deduplication logic in `lib/hours-sync.js`, writes the verified ledger to `АШК_Часы_Табель__vercel`, reads it back, and writes reconciliation results to `АШК_Сверка_часов__vercel`.

The backend, not Google Sheets, owns business-date interpretation. All timestamps that include an offset or UTC marker are converted to `Asia/Yekaterinburg`; offset-less ASHK timestamps are treated as Tyumen business-local wall time. The normalized row retains the original `FactStart` text for auditability.

## Idempotency and refresh policy

Rows are deduplicated by a stable business key built from instructor, normalized business timestamp, contract, and session type. If ASHK returns multiple versions of the same stable key in one response, the later version wins so a corrected hours value replaces the earlier value. Re-running the same period produces the same logical ledger without appended duplicates.

The production deployment schedules a daily Vercel Cron call to `/api/sync-hours` at `18:30 UTC` (`23:30` Tyumen). Cron uses `CRON_SECRET` and GET; manual/diagnostic synchronization remains POST-only with `VECTOR_SYNC_KEY` or `TOCHKA_BRIDGE_KEY`. Each daily run replaces the current Tyumen month in staging, so the final three days of a month are naturally re-fetched again on the month-closing run without partial-merge complexity.

## Reconciliation

The reconciliation sheet records source-row count, duplicate count, normalized-row count, total hours, per-date totals, load timestamp, business timezone, and an explicit `OK`/`ERROR` verification status after reading the raw sheet back. For August 2026, the current validated control is 2,665 rows and 7,306 hours; this is a regression control, not a hard-coded production rule for future months.

## Error handling

The sync must fail closed when ASHK returns invalid JSON, a row cannot be assigned to the requested business month, Google credentials are missing, cron authentication is missing/incorrect, or the read-back metrics differ from source metrics. A failed verification must not be represented as `OK`.

## Scope

This change covers only ASHK instructor-hour ingestion and reconciliation. It does not redesign payment ingestion, bank ingestion, P&L formulas, or the owner dashboard.

## Testing

Pure unit tests cover timezone normalization, month-boundary behavior, stable keys, duplicate/correction handling, reconciliation status, and the August control fixture. Handler tests cover manual authorization, cron-only authorization, current Tyumen month selection, fetch/write/read-back ordering, and verification failures.