# ASHK Receivables Staging Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically collect current ASHK contract receivables with responsible manager and branch into a Google Sheets staging sheet without modifying the existing live receivables process.

**Architecture:** Use `StudyGroupList` to obtain group-to-branch mapping, then call `StudentExternalList?StudyGroupId=...` for groups and use the list-level `Debt`, `SalesSum`, `DebitSum`, and `OwnerName` fields already confirmed in live ASHK data. Build debtor rows and manager/branch summaries in pure helpers, then wire the staging sync into the existing nightly orchestrator so no additional Vercel serverless function is created.

**Tech Stack:** Node.js 24, Vercel Functions, native `fetch`, Google Sheets API via `googleapis`, Node `node:test`.

**Spec:** Existing Vector finance architecture and live ASHK API verification on branch `preview-ashk-receivables-discovery-20260901`.

## Global Constraints

- ASHK access remains read-only.
- Production financial sheets are not modified during validation; write only to `АШК_Дебиторка__vercel` and `АШК_Дебиторка_Свод__vercel`.
- Do not add a new `api/*.js` route because the Hobby project is already at the serverless-function limit.
- Do not log student names, phone numbers, contract numbers, or other PII.
- Use bounded concurrency and request timeouts for ASHK calls.
- A debtor row is a contract with `Debt > 0`.

---

### Task 1: Receivables normalization and summaries

**Files:**
- Create: `test/ashk-receivables.test.js`
- Create: `lib/ashk-receivables.js`

**Interfaces:**
- Produces: `buildReceivableRows(groups, contractsByGroup)` and `buildReceivableSummary(rows)`.

- [ ] Write failing tests for branch mapping, numeric normalization, debt filtering, manager aggregation, branch aggregation, and totals.
- [ ] Run tests and verify RED because `lib/ashk-receivables.js` does not exist.
- [ ] Implement minimal pure helpers.
- [ ] Run tests and verify GREEN.
- [ ] Commit.

### Task 2: ASHK collector with bounded concurrency

**Files:**
- Create: `test/ashk-receivables-source.test.js`
- Create: `lib/ashk-receivables-source.js`

**Interfaces:**
- Produces: `createAshkReceivablesSource({ fetchFn, baseUrl, apiKey, concurrency, timeoutMs })` with `fetchCurrent()` returning `{ groups, contractsByGroup }`.

- [ ] Write failing tests using a deterministic fake fetch for group loading, per-group student lists, timeout/error reporting, and concurrency limit.
- [ ] Run tests and verify RED.
- [ ] Implement the smallest collector that passes.
- [ ] Run tests and verify GREEN.
- [ ] Commit.

### Task 3: Google Sheets staging sync

**Files:**
- Create: `test/receivables-sync-handler.test.js`
- Create: `lib/receivables-sync-handler.js`
- Modify: `api/nightly-finance-orchestrator.js`

**Interfaces:**
- Produces: `createReceivablesSyncHandler({ fetchCurrent, writeDetail, writeSummary })` returning an internal GET-compatible handler.

- [ ] Write failing tests proving only positive-debt rows are written and summary totals equal detail totals.
- [ ] Run tests and verify RED.
- [ ] Implement staging writer and Google Sheets wiring without creating a new API route.
- [ ] Run tests and verify GREEN.
- [ ] Commit.

### Task 4: Nightly orchestrator stage

**Files:**
- Modify: `test/nightly-finance-orchestrator.test.js`
- Modify: `lib/nightly-finance-orchestrator.js`
- Modify: `api/nightly-finance-orchestrator.js`

**Interfaces:**
- `createNightlyFinanceOrchestrator({ cronSecret, runHours, runReceivables, runDecisions })`.

- [ ] Write failing test for ordered stages `hours -> receivables -> decisions` and skip semantics on receivables failure.
- [ ] Run tests and verify RED.
- [ ] Implement the new stage.
- [ ] Run full `npm test` and verify GREEN.
- [ ] Commit.

### Task 5: Preview live verification

**Files:**
- Modify preview-only diagnostics as needed.

- [ ] Deploy preview branch.
- [ ] Verify build and tests.
- [ ] Run read-only live collector and compare aggregate debt to the current management snapshot before any production merge.
- [ ] Confirm no PII appears in logs.
- [ ] Remove temporary build-time diagnostics before opening the PR.
