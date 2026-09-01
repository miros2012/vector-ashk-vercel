# Decision Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically reconcile Decision Engine state after real financial-source changes and once daily, while remaining dry-run by default and preserving rollback-safe cutover.

**Architecture:** Reuse the existing Decision Shadow adapter and guarded Decision State Synchronizer. Add a small reconciliation composition service, invoke it after a successful live Tochka balance mirror, and expose one CRON_SECRET-protected daily reconciliation route. The current Sheets formulas remain source of truth until `DECISION_STATE_WRITES_ENABLED=true` is explicitly enabled later.

**Tech Stack:** Node.js 20/24, Vercel Functions, Vercel Cron, Google Sheets API, node:test.

**Spec:** `docs/superpowers/specs/2026-09-01-decision-reconciliation-design.md`

## Global Constraints

- Current Vercel team plan is Hobby; configure exactly one daily cron.
- Feature development remains on slash branches so Vercel Preview deployments stay disabled.
- `DECISION_STATE_WRITES_ENABLED` must default to disabled.
- Reconciliation responses must not expose Rule IDs, mismatch details, financial amounts, linked objects, or sheet contents.
- `sync-payments` and `sync-hours` are not reconciliation triggers in this iteration because they are staging/reconciliation sources, not canonical live financial facts.
- Existing formula backup, atomic H/J/M/P write, shadow verification, and rollback behavior must remain unchanged.

---

### Task 1: Reconciliation composition service

**Files:**
- Create: `lib/decision-reconciliation.js`
- Test: `test/decision-reconciliation.test.js`

**Interfaces:**
- Consumes: `synchronizeDecisionState({ dryRun: boolean }) -> Promise<syncResult>`
- Produces: `createDecisionReconciler({ synchronize, writesEnabled, logger }) -> async reconcile({ trigger })`

- [ ] **Step 1: Write failing tests** for dry-run when writes are disabled, commit request when writes are enabled, aggregate result normalization, and failure logging without leaking internals.
- [ ] **Step 2: Run targeted tests** with `node --test test/decision-reconciliation.test.js`; expect module-not-found RED.
- [ ] **Step 3: Implement minimal service** that calls `synchronize({ dryRun: !writesEnabled })` exactly once and returns only `{ok, mode, verified, total, matches, writeCount, trigger}`.
- [ ] **Step 4: Re-run targeted tests** and confirm GREEN.
- [ ] **Step 5: Commit** `feat: add decision reconciliation service`.

### Task 2: Live balance event hook

**Files:**
- Modify: `api/balances.js`
- Create: `test/balance-decision-reconciliation.test.js`

**Interfaces:**
- Consumes: existing successful `mirrorToGoogleSheet(normalized, sheets)` and Task 1 reconciler.
- Produces: balance response with non-sensitive `decisionReconciliation` aggregate object after actual refresh; cached balance responses do not invoke reconciliation.

- [ ] **Step 1: Write failing wiring/behavior tests** proving reconciliation runs after a successful mirror, does not run on the 30-second cached path, and a reconciliation failure does not convert successful balance refresh into HTTP 500.
- [ ] **Step 2: Run targeted tests** and confirm RED.
- [ ] **Step 3: Implement minimal hook** using the same Google Sheets client and existing Decision Shadow + State Synchronizer; configure writes from `DECISION_STATE_WRITES_ENABLED === 'true'`.
- [ ] **Step 4: Re-run balance and Tochka tests** and confirm GREEN.
- [ ] **Step 5: Commit** `feat: reconcile decisions after live balance refresh`.

### Task 3: Daily protected reconciliation route

**Files:**
- Create: `api/decision-reconcile-daily.js`
- Create: `test/decision-reconcile-daily.test.js`

**Interfaces:**
- Consumes: `CRON_SECRET`, Google service account, Decision Shadow adapter, State Synchronizer, Task 1 reconciler.
- Produces: GET-only endpoint returning aggregate reconciliation health.

- [ ] **Step 1: Write failing tests** for GET-only behavior, missing/wrong `Authorization: Bearer <CRON_SECRET>` rejected before Sheets reads, dry-run default, generic 500 on internal failure, and no sensitive fields in response.
- [ ] **Step 2: Run targeted tests** and confirm RED.
- [ ] **Step 3: Implement route** with Google Sheets write scope because the same route must support later guarded cutover; actual write still requires `DECISION_STATE_WRITES_ENABLED=true`.
- [ ] **Step 4: Re-run targeted tests** and confirm GREEN.
- [ ] **Step 5: Commit** `feat: add daily decision reconciliation route`.

### Task 4: Hobby-safe Vercel Cron configuration

**Files:**
- Modify: `vercel.json`
- Create: `test/vercel-cron-policy.test.js`

**Interfaces:**
- Consumes: `/api/decision-reconcile-daily`.
- Produces: exactly one daily cron definition.

- [ ] **Step 1: Write failing config test** that parses `vercel.json`, asserts exactly one cron, path `/api/decision-reconcile-daily`, and a once-daily five-field schedule with no wildcard minute/hour recurrence.
- [ ] **Step 2: Run targeted test** and confirm RED.
- [ ] **Step 3: Add one daily cron** at `15 0 * * *` (00:15 UTC / 05:15 Tyumen), preserving Git deployment filters and function settings.
- [ ] **Step 4: Re-run config test** and confirm GREEN.
- [ ] **Step 5: Commit** `feat: schedule daily decision reconciliation`.

### Task 5: Full regression and production-safe release

**Files:**
- No new runtime files unless tests expose a defect.

**Interfaces:**
- Produces: one fast-forward to `main`, one production deployment, writes still disabled.

- [ ] **Step 1: Run full GitHub Actions suite** with `npm test`; require all tests PASS and 0 FAIL.
- [ ] **Step 2: Verify feature branch generated zero Vercel Preview deployments/statuses.**
- [ ] **Step 3: Compare `main...feat/decision-reconciliation-scheduler`; require `behind_by=0` before fast-forward.**
- [ ] **Step 4: Fast-forward `main` once without force.**
- [ ] **Step 5: Wait for the single production deployment to reach READY; do not create another deploy.**
- [ ] **Step 6: Production smoke tests:** `decision-shadow-status` remains 4/4 drift 0; daily route rejects unauthenticated requests; balance refresh remains live.
- [ ] **Step 7: Verify `DECISION_STATE_WRITES_ENABLED` was not enabled as part of this release.**

### Task 6: Dry-run operational validation before cutover

**Files:**
- Update product status in Google Sheets only after production evidence exists.

**Interfaces:**
- Produces: evidence that both event-driven and daily paths can reconcile safely before formula ownership changes.

- [ ] **Step 1: Observe one real live-balance refresh and confirm reconciliation aggregate reports dry-run success.**
- [ ] **Step 2: Confirm production shadow remains 4/4 drift 0 after that financial change.**
- [ ] **Step 3: Confirm `CRON_SECRET` exists before relying on Vercel Cron. If unavailable, leave cron configured but report it as inactive/blocked rather than weakening authentication.**
- [ ] **Step 4: Do not enable writes in this plan. A separate controlled cutover step will enable `DECISION_STATE_WRITES_ENABLED=true` only after these checks.**
