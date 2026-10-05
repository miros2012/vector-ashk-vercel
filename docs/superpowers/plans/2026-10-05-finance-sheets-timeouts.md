# Bounded financial snapshot I/O implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Financial snapshot publication must return a classified failure instead of waiting indefinitely for Google Sheets.

**Architecture:** Reuse `boundedGoogleSheetsRequest` (12 second default, transport timeout, no SDK retries). Bound each snapshot preparation, read, write, readback and success-marker request. Do not add request-level retries to writes or imply rollback after an ambiguous timeout.

**Tech Stack:** Node 24, JavaScript ESM, googleapis, node:test; no dependencies added.

**Spec:** `/Users/miroslavkononenko/Documents/Codex/vector-finance-remediation-status-2026-10-05.md`, next-task item “Ограничить время обращений к Sheets”, plus owner's instruction to continue technical repairs without changing financial facts.

## Global Constraints

- Production is not invoked for tests. No import, financial classification, amounts, schedule, credentials or deployment changes.
- Reuse isolated checkout on a new branch based on released `51a085b`; preserve dirty primary checkout.
- Preserve one padded snapshot batch and full ROP readback, RAW writes, existing formulas and schemas.
- Deadline applies per request, not a guarantee that the complete multi-sheet job fits its serverless duration.
- Timeout is an unknown write outcome; never automatically replay appends and never publish a success marker after an earlier timeout.
- Failed cached authorization must not poison subsequent independent invocations.

## Review Focus

- Google client never settles: local timeout returns with phase; later stages are not called.
- Server accepted a write but response is lost: exactly one request; no rollback claim or retry append.
- Header-only shorter snapshots remove old tail without any destructive pre-clear.
- Metadata creation/resizing, formatting or readback hangs after a write: publication is unsuccessful, not falsely fresh.
- Cached JWT promise rejects once: next invocation may authorize again, no credentials in messages.

### Task 1: Bound snapshot publication and supporting requests

**Files:**
- Modify: `lib/google-sheets-atomic-snapshots.js`, `lib/google-sheets-sync-marker.js`, `lib/rop-debtor-format.js`
- Modify: `api/sync-hours.js`, `api/nightly-finance-orchestrator.js`, ROP/marker paths in `api/health.js`
- Test: `test/google-sheets-atomic-snapshots.test.js`, `test/finance-snapshot-write-safety.test.js`, `test/finance-support-request-timeouts.test.js`

**Interfaces:**
- Consumes: `boundedGoogleSheetsRequest(execute, timeoutMs = 12000, phase)`; passes `{ timeout, retry: false }` as Google SDK second argument.
- Produces: existing APIs and payloads; shared snapshot/marker/formatter functions additionally accept optional `requestTimeoutMs` for local fault tests. Routes use default timeout.

- [x] **Step 1: Add failing behavior tests.** Snapshot read/write never-settling promises must reject within a 20ms injected bound with phases `snapshot-read` / `snapshot-write`, no following write and no replay. Marker and formatter never-settling I/O must reject without later requests. Real route callbacks must forward bounded SDK options on metadata/read/readback; cached authorization rejection must be recoverable. Test header-only replacement (old tail cleared only in one batch).
- [x] **Step 2: Run tests and verify missing bounded behavior fails.** `node --test test/google-sheets-atomic-snapshots.test.js test/finance-snapshot-write-safety.test.js test/finance-support-request-timeouts.test.js`; expected newly added tests FAIL for missing timeout/options/retry recovery, old tests PASS.
- [x] **Step 3: Wrap each affected Google request in the existing helper.** No financial algorithm changes. Preserve Google payloads; reset failed cached auth promises in hours and ROP clients.
- [x] **Step 4: Run targeted tests then `npm test`.** Expected all PASS, no unreported failures. Full suite may require local network permission for loopback fixtures; no production I/O.
- [ ] **Step 5: Commit the verified change.** `git add` only named implementation/test/plan files; `git commit -m "fix(finance): bound snapshot publication requests"`.

## Execution and release

Owner explicitly requested continuing repairs without phase-by-phase permission requests. Execute inline; one independent whole-branch review before PR handoff. Create a feature PR after passing tests, attach it to this task; do not merge/release without new explicit release authorization.
