# Nightly Finance Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace competing daily Vercel crons with one 02:30 Tyumen orchestrator that runs verified ASHK HOURS first and decision reconciliation second.

**Architecture:** Keep `/api/sync-hours` and `/api/decision-reconcile-daily` independent and protected. Add `/api/nightly-finance-orchestrator` as the only scheduled route; it internally invokes HOURS first and only invokes decisions after HOURS succeeds, using `CRON_SECRET` without exposing it.

**Tech Stack:** Node.js ESM, Vercel Functions/Cron, Node built-in test runner, Google Sheets API, ASHK API.

**Spec:** `docs/superpowers/specs/2026-09-01-nightly-finance-orchestrator-design.md`

## Global Constraints

- Exactly one Vercel Hobby cron.
- Business timezone: `Asia/Yekaterinburg`.
- Cron schedule: `30 21 * * *` UTC / 02:30 Tyumen.
- Preserve independent protected HOURS and decision-reconciliation routes.
- Do not expose `CRON_SECRET` in code, responses, logs, query parameters, or repository content.
- Do not change production master rates, `Фонд вождения`, or canonical payroll calculations.
- Final branch must be synchronized with current `main` and pass the full test suite before merge.

---

### Task 1: Orchestrator HTTP contract

**Files:**
- Create: `lib/nightly-finance-orchestrator.js`
- Create: `test/nightly-finance-orchestrator.test.js`

**Interfaces:**
- Consumes: `runHours(req, res)`, `runDecisions(req, res)`, `cronSecret`.
- Produces: `createNightlyFinanceOrchestrator({ cronSecret, runHours, runDecisions }) -> async handler(req, res)`.

- [ ] **Step 1: Write failing tests** covering: GET-only; missing/wrong bearer secret rejected; HOURS invoked before decisions; decisions skipped if HOURS is non-2xx or `{ok:false}`; successful response contains only aggregate stage statuses.
- [ ] **Step 2: Run** `node --test test/nightly-finance-orchestrator.test.js` and require the new test file to fail because implementation is absent.
- [ ] **Step 3: Implement minimal orchestrator** with an in-memory response adapter that captures status/body from each existing handler. Build internal child requests with `method='GET'`, empty query/body, and `Authorization: Bearer ${cronSecret}`. Never include the secret in returned data.
- [ ] **Step 4: Re-run** `node --test test/nightly-finance-orchestrator.test.js` and require all targeted tests to pass.
- [ ] **Step 5: Commit** `feat: add nightly finance orchestrator service`.

### Task 2: Vercel route wiring

**Files:**
- Create: `api/nightly-finance-orchestrator.js`
- Test: `test/nightly-finance-orchestrator.test.js`

**Interfaces:**
- Consumes: default handlers from `api/sync-hours.js`, `api/decision-reconcile-daily.js`, and `process.env.CRON_SECRET`.
- Produces: default Vercel function handler for `/api/nightly-finance-orchestrator`.

- [ ] **Step 1: Add a failing wiring assertion** that imports the route and verifies missing `CRON_SECRET` is rejected before child handlers can execute.
- [ ] **Step 2: Run** the targeted test and verify failure before route creation.
- [ ] **Step 3: Create the route** by composing `createNightlyFinanceOrchestrator` with the two existing handlers and runtime `CRON_SECRET`.
- [ ] **Step 4: Re-run** the targeted tests and require PASS.
- [ ] **Step 5: Commit** `feat: wire nightly finance orchestrator route`.

### Task 3: Single Hobby-safe cron policy

**Files:**
- Modify: `vercel.json`
- Modify or create: `test/vercel-cron-policy.test.js`

**Interfaces:**
- Consumes: `/api/nightly-finance-orchestrator`.
- Produces: exactly one cron `{ "path": "/api/nightly-finance-orchestrator", "schedule": "30 21 * * *" }`.

- [ ] **Step 1: Update the cron-policy test first** to assert `crons.length === 1`, exact path `/api/nightly-finance-orchestrator`, and exact schedule `30 21 * * *`.
- [ ] **Step 2: Run** `node --test test/vercel-cron-policy.test.js`; require RED against the existing decision-only cron configuration.
- [ ] **Step 3: Change `vercel.json`** to the single orchestrator cron while preserving deployment filters and function duration settings. Add `api/nightly-finance-orchestrator.js` maxDuration 60 if the configuration uses explicit function durations.
- [ ] **Step 4: Re-run** the cron-policy test and require PASS.
- [ ] **Step 5: Commit** `feat: schedule single nightly finance orchestrator`.

### Task 4: Rebase integration onto current main without losing either subsystem

**Files:**
- Reconcile current `main` versions of `vercel.json`, `api/sync-hours.js`, `lib/hours-sync.js`, `lib/sync-hours-handler.js`, and all decision-reconciliation files with the HOURS feature versions.

**Interfaces:**
- Consumes: current `main` at execution time and feature HEAD.
- Produces: feature branch with `behind_by=0`, preserving current decision code plus HOURS archive/timezone behavior.

- [ ] **Step 1: Fetch current `main` SHA and compare `main...feat/ashk-hours-automatic-sync`.** Record files modified on both sides.
- [ ] **Step 2: Build the integrated branch from current `main` rather than force-overwriting `main`.** Preserve all files not touched by HOURS exactly from `main`.
- [ ] **Step 3: Apply HOURS-specific versions only where required:** Tyumen timestamp normalization, stable-key correction supersession, archive staging, cron GET auth, and month-close sequencing.
- [ ] **Step 4: Apply Tasks 1–3 orchestrator files/config on top of that integrated tree.**
- [ ] **Step 5: Compare again and require `behind_by=0`; do not proceed if `main` moved again without another synchronization pass.**

### Task 5: Full regression and Preview live gate

**Files:**
- No production files unless tests expose a defect.

**Interfaces:**
- Produces: fresh automated and live evidence for release.

- [ ] **Step 1: Run full test suite** with `npm test`; require zero failures and record exact pass count.
- [ ] **Step 2: Create one controlled `preview-*` deployment from the exact integrated candidate SHA after Preview `CRON_SECRET` is enabled.**
- [ ] **Step 3: Verify `/api/health` returns 200 and integrations required by HOURS are configured.**
- [ ] **Step 4: Invoke authenticated HOURS through a preview-only harness that reads the runtime secret internally; require HTTP 200 and `comparison.ok=true`. The harness must never enter the feature PR or production tree.
- [ ] **Step 5: On Sep 1–3, verify both archive and current staging:** `АШК_Часы_Табель__vercel__2026-08` + matching reconciliation archive, and current September staging. Require `verification=OK` and exact source↔staging metrics for each.
- [ ] **Step 6: Delete preview-only harness/marker from the controlled preview branch after evidence is collected.**

### Task 6: Release gate

**Files:**
- PR metadata only; production code already prepared.

**Interfaces:**
- Produces: one reviewed production release with one scheduled cron.

- [ ] **Step 1: Re-check current `main`; require feature `behind_by=0`.**
- [ ] **Step 2: Re-run full `npm test` on the exact release candidate and require zero failures.**
- [ ] **Step 3: Confirm PR is mergeable and review changed files for accidental preview-only artifacts or secrets.**
- [ ] **Step 4: Merge only after live HOURS staging gate is green.**
- [ ] **Step 5: Wait for production deployment READY.**
- [ ] **Step 6: Verify exactly one cron is deployed at `/api/nightly-finance-orchestrator`, schedule `30 21 * * *`.**
- [ ] **Step 7: Verify production smoke health and the first scheduled run from runtime logs plus Google Sheets reconciliation state.**
