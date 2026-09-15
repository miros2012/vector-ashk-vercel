# Finance HQ Data Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore trustworthy morning finance HQ data by fixing freshness, sync independence, Driving/Royalty forecasts, and deterministic Tochka→DDS classification.

**Architecture:** Keep existing Vercel + Google Sheets architecture. Change source adapters/orchestrators so freshness is evidence-based and source refreshes are isolated; add pure forecast/classification helpers so owner metrics are testable and do not depend on legacy sheet formulas.

**Tech Stack:** Node.js 24, native node:test, Vercel Functions, Google Sheets API.

**Spec:** `docs/superpowers/specs/2026-09-15-finance-hq-data-integrity-design.md`

## Global Constraints
- Driving allocation rate is exactly 40%.
- Royalty allocation rate is exactly 17%.
- Royalty thresholds: <6m=16%, 6–9m=14%, >9m=12%.
- Do not auto-classify ambiguous contractor/IP Egorov transfers.
- Do not write directly to `main`; use branch + PR and merge only after successful CI.

---

### Task 1: Fix cash freshness semantics
**Files:** `lib/data-health-snapshot.js`, `api/health.js`, tests under `test/data-health-*.test.js`.
- [ ] Add regression test where journal activity is old but verification/review evidence is current and status must be fresh.
- [ ] Implement parsing/selection of latest verification evidence separately from last transaction date.
- [ ] Run focused data-health tests.

### Task 2: Make ASHK refresh stages independent and refresh receivables intraday
**Files:** `lib/nightly-finance-orchestrator.js`, `lib/rop-intraday-orchestrator.js`, `api/nightly-finance-orchestrator.js`, `test/nightly-finance-orchestrator.test.js`, `test/rop-intraday-orchestrator.test.js`.
- [ ] Add failing tests proving hours/payments failure does not prevent independent receivables refresh.
- [ ] Add failing intraday test proving receivables runs before ROP publication.
- [ ] Implement best-effort independent source stages with explicit per-stage errors and prerequisite-aware downstream blocking.
- [ ] Wire `runReceivables` into intraday orchestrator.
- [ ] Run focused orchestrator tests.

### Task 3: Replace legacy Driving/Royalty owner metrics
**Files:** create `lib/finance-fund-forecast.js`; wire into owner snapshot/live package or health output; tests create `test/finance-fund-forecast.test.js` plus owner integration regression.
- [ ] Write tests for current-month master accrual by supported ASHK type, latest closed day extrapolation, 40% allocation, and projected buffer.
- [ ] Write tests for Royalty 17% accumulation and 12/14/16% threshold rate selection.
- [ ] Implement pure helpers and wire owner-facing metrics to them instead of prior-month average reserve.
- [ ] Run focused forecast/owner tests.

### Task 4: Reduce deterministic Tochka→DDS manual backlog
**Files:** identify the existing Tochka operation classification builder in `api/health.js`/related source; add `lib/tochka-dds-classification.js` if classification is currently formula-like; tests create `test/tochka-dds-classification.test.js` and wiring test.
- [ ] Add failing tests for student refund, admin salary advance, FSSP/alimony withholding and ambiguous contractor no-match.
- [ ] Implement conservative deterministic rules.
- [ ] Wire rules before manual-review fallback.
- [ ] Run focused Tochka DDS tests.

### Task 5: Full verification and production rollout
- [ ] Run complete `npm test` through GitHub Actions on the PR branch.
- [ ] Verify Vercel deployment is READY.
- [ ] Verify production markers: fresh hours/payments/receivables, current-day ROP, corrected cash freshness, Driving/Royalty forecasts, and reduced manual DDS backlog.
- [ ] Merge only if CI and production checks are green; otherwise leave PR open with exact blocker.
