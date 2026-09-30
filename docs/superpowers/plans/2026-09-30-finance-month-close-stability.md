# Finance Month-Close Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Vector finance contour reliably refresh, explain failures, preserve cash audit trails, exclude paid obligations from forecasts, and expose truthful month-close readiness without altering unconfirmed financial facts.

**Architecture:** Keep source ingestion, freshness evidence, reconciliation, and financial publication separate. Store source-run evidence as explicit timestamps/status/error details, derive Data Health from those markers, and allow ledger/forecast mutations only from confirmed source identities or transaction IDs. Cash checkpoint and audit-trail repairs remain idempotent and never recreate DDS facts.

**Tech Stack:** Node.js 24, Vercel Functions/Cron, Google Sheets API, `node:test`.

**Spec:** User request dated 2026-09-30 in this task.

## Global Constraints

- Do not change financial facts, ambiguous operations, or historical classifications without Miroslav's confirmation.
- Do not repair reconciliation by inserting balancing differences.
- Require exact transaction IDs before closing bank-backed obligations.
- Preserve existing DDS rows and make provenance repair idempotent.
- September P&L remains blocked until complete 30.09 ASHK and external-source cutoffs are available.

## Review Focus

- Google serial dates versus ISO timestamps must never produce January 1900 freshness markers.
- A successful function response with stale source data must remain distinguishable from a successful current sync.
- A confirmed cash checkpoint must supersede an older checkpoint without replaying its source movements.
- Obligation matching must reject amount-only matches and duplicate transaction IDs.
- Reconciliation and P&L must remain blocked when source cutoffs differ.

---

### Task 1: Source run evidence and Data Health

**Files:**
- Modify: `lib/data-health-snapshot.js`
- Modify: `lib/google-sheets-sync-marker.js`
- Modify: `lib/nightly-finance-orchestrator.js`
- Test: `test/data-health-*.test.js`
- Test: `test/nightly-finance-orchestrator*.test.js`

**Interfaces:**
- Consumes: source sync results and Google Sheet markers.
- Produces: normalized source timestamps, last successful run, last attempt, status, and concrete blocker reason.

- [ ] Add failing tests for serial timestamps, ISO timestamps, stale-source success, and stage failures.
- [ ] Implement strict timestamp normalization and explicit run evidence.
- [ ] Expose source-specific Data Health details and concrete BLOCKED reasons.
- [ ] Run focused tests.

### Task 2: Cash checkpoint and audit-trail integrity

**Files:**
- Modify: `lib/cash-photo-store.js`
- Modify: `lib/cash-journal-pipeline.js`
- Test: `test/cash-photo-store.test.js`
- Test: `test/cash-journal-pipeline.test.js`

**Interfaces:**
- Consumes: confirmed photo, draft rows, wallet checkpoint, DDS markers.
- Produces: newest checkpoint selection and one-to-one journal-to-DDS provenance without replay.

- [ ] Add failing tests for a newer confirmed photo superseding an older checkpoint.
- [ ] Add failing tests for audit-log recovery when DDS already exists.
- [ ] Implement idempotent checkpoint advancement and provenance repair.
- [ ] Run focused tests.

### Task 3: Obligation payment matching and forecast exclusion

**Files:**
- Modify: `lib/obligation-status.js`
- Modify: `lib/owner-live-source-reader.js`
- Modify: `lib/cash-scenario-forecast.js`
- Test: obligation and forecast tests.

**Interfaces:**
- Consumes: obligation IDs, bank transaction IDs, payment evidence.
- Produces: paid/open obligation state and forecast cash outflow.

- [ ] Add failing tests rejecting amount-only matching and accepting exact transaction IDs.
- [ ] Implement payment evidence matching and paid exclusion.
- [ ] Run focused tests and recalculate forecast fixtures.

### Task 4: Reconciliation, P&L readiness, driving fund, and royalty policy

**Files:**
- Modify: relevant reconciliation, owner snapshot, decision and forecast modules discovered by tests.
- Test: reconciliation, owner dashboard, decision, and policy tests.

**Interfaces:**
- Consumes: common source cutoff, refund evidence, paid automobile costs, current royalty bands.
- Produces: reconciliation state, month-close gate, residual driving need, and royalty rate.

- [ ] Add failing tests for mismatched cutoffs and a single 2,700 refund difference.
- [ ] Add failing tests for the driving-fund formula and paid-cost exclusion.
- [ ] Add failing tests for 15%/13%/11% royalty bands and search guard against 16%/14%/12%.
- [ ] Implement minimal fixes and run focused tests.

### Task 5: Live evidence, safe sheet repairs, and control run

**Files:**
- Modify Google Sheets only where confirmed by source IDs/checkpoints.
- Modify source scheduling/config only when root cause evidence supports it.

**Interfaces:**
- Consumes: production markers, logs, confirmed photos, bank transaction IDs.
- Produces: repaired live state, recalculated forecast, and final audit report.

- [ ] Record exact root cause for each reported issue.
- [ ] Apply only evidence-backed sheet changes; leave ambiguous Gondatti rows unresolved.
- [ ] Run full tests and live readback checks.
- [ ] Verify source timestamps, Data Health details, forecast, and unchanged ambiguous facts.

