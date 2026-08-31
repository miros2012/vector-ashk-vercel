# ASHK Hours Automatic Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ASHK instructor-hour sync timezone-safe, idempotent, auditable, and automatically verifiable in the existing Vercel → Google Sheets pipeline.

**Architecture:** Keep `api/sync-hours.js` as the external integration boundary and move business-date normalization plus stable-key logic into `lib/hours-sync.js`. The handler writes normalized rows to `АШК_Часы_Табель__vercel`, reads them back, compares source vs staging metrics, and writes an explicit reconciliation result to `АШК_Сверка_часов__vercel`.

**Tech Stack:** Node.js ESM, Vercel Functions, Google Sheets API via `googleapis`, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-31-ashk-hours-automatic-sync-design.md`

## Global Constraints

- ASHK source: `GET /api/MasterWorkReportDetails` with `BuildMode=1` and `PlanFact=0`.
- Business timezone: `Asia/Yekaterinburg`.
- Preserve original `FactStart` text for auditability.
- August 2026 regression control: 2,665 normalized rows and 7,306 hours.
- Do not modify payments, bank ingestion, P&L, Fund driving, or owner-dashboard logic in this change.

---

### Task 1: Business-time normalization and stable keys

**Files:**
- Modify: `lib/hours-sync.js`
- Modify: `test/hours-sync.test.js`

**Interfaces:**
- Produces: `businessDateFromFactStart(value, timeZone)` returning `YYYY-MM-DD`.
- Produces: normalized rows whose `Key` is stable across repeated imports of the same ASHK fact.

- [ ] Add failing tests for offset timestamps that cross a Tyumen date boundary, offset-less timestamps, invalid timestamps, repeated imports, and month-boundary rejection.
- [ ] Run `npm test` and confirm the new tests fail.
- [ ] Implement timezone normalization with `Asia/Yekaterinburg` as the production default while preserving offset-less ASHK wall time as local Tyumen time.
- [ ] Build the stable key from identifying fields and normalized business timestamp, excluding mutable load metadata.
- [ ] Run `npm test` and confirm all tests pass.

### Task 2: Reconciliation metadata and explicit verification

**Files:**
- Modify: `lib/hours-sync.js`
- Modify: `lib/sync-hours-handler.js`
- Modify: `test/hours-sync.test.js`
- Modify: `test/sync-hours-handler.test.js`

**Interfaces:**
- Reconciliation rows include business timezone and verification status.
- `compareHoursMetrics(source, staging)` remains the gate for `OK`/`ERROR`.

- [ ] Add failing tests requiring timezone metadata and a non-OK result on any rows/hours mismatch.
- [ ] Run `npm test` and confirm failure.
- [ ] Extend reconciliation output with `Business timezone = Asia/Yekaterinburg` and preserve the existing verification row.
- [ ] Ensure the handler returns HTTP 502 when read-back metrics differ and writes `ERROR` before returning.
- [ ] Run `npm test` and confirm all tests pass.

### Task 3: Active-month refresh policy

**Files:**
- Modify: `lib/sync-hours-handler.js`
- Modify: `api/sync-hours.js`
- Modify: `test/sync-hours-handler.test.js`

**Interfaces:**
- Default POST with no month syncs the current Tyumen month.
- Explicit `month: YYYY-MM` remains supported for deterministic re-sync/closing.
- Full-period replacement remains idempotent and therefore safely re-fetches the last three month-end days on every closing run.

- [ ] Add tests for current Tyumen month selection and explicit month override.
- [ ] Confirm repeated execution with identical API rows yields identical raw values except `LoadedAt`.
- [ ] Keep full-month replacement as the canonical implementation for now; document that this automatically re-fetches the final three days and avoids partial-merge complexity.
- [ ] Run `npm test`.

### Task 4: August regression and deployment verification

**Files:**
- Modify: `test/hours-sync.test.js` only if a compact fixture is needed.
- No production-sheet edits until the deployed endpoint passes tests.

**Interfaces:**
- August control expected after live sync: 2,665 rows / 7,306 hours.

- [ ] Run `npm test` and syntax checks.
- [ ] Deploy the feature branch to Vercel preview.
- [ ] Invoke the preview `POST /api/sync-hours` for `2026-08` with the configured sync key.
- [ ] Verify HTTP 200, `comparison.ok=true`, source/staging rows=2,665, hours=7,306, and reconciliation status `OK`.
- [ ] Re-read `АШК_Часы_Табель__vercel` and `АШК_Сверка_часов__vercel` from Google Sheets and confirm the same metrics.
- [ ] Only after verification, merge/deploy to production.
