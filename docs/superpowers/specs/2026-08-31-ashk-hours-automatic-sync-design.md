# ASHK Hours Automatic Sync Design

**Goal:** Make `MasterWorkReportDetails` the single authoritative source of instructor hours, normalize business dates in `Asia/Yekaterinburg`, publish an idempotent raw ledger to Google Sheets, and continuously reconcile the imported ledger.

## Architecture

`api/sync-hours.js` remains the only external integration point for ASHK hours. It requests a bounded period from `MasterWorkReportDetails`, passes rows to pure normalization/deduplication logic in `lib/hours-sync.js`, writes the verified ledger to `АШК_Часы_Табель__vercel`, reads it back, and writes reconciliation results to `АШК_Сверка_часов__vercel`.

The backend, not Google Sheets, owns business-date interpretation. All timestamps that include an offset or UTC marker are converted to `Asia/Yekaterinburg`; offset-less ASHK timestamps are treated as Tyumen business-local wall time. The normalized row retains the original `FactStart` text for auditability.

## Idempotency and refresh policy

Rows are deduplicated by a stable business key built from immutable identifying fields and the normalized business timestamp. Re-running the same period produces the same ledger without duplicate rows. For the active month, automated refreshes re-fetch the month to date; during month close, the final three calendar days are always re-fetched before the month is considered closed so late ASHK corrections replace earlier values rather than append duplicates.

## Reconciliation

The reconciliation sheet records source-row count, duplicate count, normalized-row count, total hours, per-date totals, load timestamp, business timezone, and an explicit `OK`/`ERROR` verification status after reading the raw sheet back. For August 2026, the current validated control is 2,665 rows and 7,306 hours; this is a regression control, not a hard-coded production rule for future months.

## Error handling

The sync must fail closed when ASHK returns invalid JSON, a row cannot be assigned to the requested business month, Google credentials are missing, or the read-back metrics differ from source metrics. A failed verification must not be represented as `OK`.

## Scope

This change covers only ASHK instructor-hour ingestion and reconciliation. It does not redesign payment ingestion, bank ingestion, P&L formulas, or the owner dashboard.

## Testing

Pure unit tests cover timezone normalization, month-boundary behavior, stable keys, duplicate removal, reconciliation status, and the August control fixture. Handler tests cover authorization, fetch/write/read-back ordering, and verification failures.