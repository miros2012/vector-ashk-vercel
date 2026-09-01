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

- [x] Implemented and tested.

### Task 2: Live balance event hook

- [x] Implemented and tested.

### Task 3: Daily protected reconciliation route

- [x] Implemented and tested.

### Task 4: Hobby-safe Vercel Cron configuration

- [x] One daily cron configured at `15 0 * * *` (00:15 UTC / 05:15 Tyumen).

### Task 5: Full regression and production-safe release

- [x] Full suite passed: 85/85, 0 fail.
- [x] Feature branch produced zero Preview deployments.
- [x] Fast-forwarded to `main` without force.
- [x] Single production deployment reached READY.
- [x] Production shadow remained 4/4, drift 0.
- [x] `DECISION_STATE_WRITES_ENABLED` remained disabled.

### Task 6: Dry-run operational validation before cutover

- [x] Real live-balance refresh triggered decision reconciliation in dry-run mode.
- [x] Production shadow remained 4/4, drift 0 after the financial refresh.
- [x] User added `CRON_SECRET` to Production on 2026-09-01; this commit intentionally triggers one redeploy so the new secret is injected into runtime.
- [ ] Verify the daily cron endpoint no longer reports `Cron unavailable` after redeploy.
- [ ] Verify one authorized daily dry-run returns 4/4 with writes still disabled.
- [ ] Keep writes disabled until a separate controlled cutover step.
