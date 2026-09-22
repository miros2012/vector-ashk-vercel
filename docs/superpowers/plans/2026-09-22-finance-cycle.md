# Finance Cycle Implementation Plan

> Native execution in this session using executing-plans; user already requested implementation of the three proposed fixes.

**Goal:** Resume the financial update reliably and verify P&L before overall success.
**Architecture:** One stage per authenticated invocation, durable checkpoint under the existing lease, deterministic report refresh and final verification.
**Tech Stack:** Node 24, node:test, googleapis, existing Vercel/GitHub schedules.
**Spec:** ../specs/2026-09-22-finance-cycle-design.md

## Global constraints
Preserve auth, shared lease, finance classifications, cash balances and missing current-month revenue. No new financial transactions. Do not touch unrelated open PRs.

## Review focus
Crash after committed writes replays idempotently. Duplicate/malformed checkpoint blocks. Concurrent imports invalidate report verification. Conflicting directory entries block. Recovery never executes owner actions.

## Tasks
- [x] Add failing cycle tests: save RUNNING before side effects, resume only unfinished stage, lease busy, three failed attempts, final COMPLETE after all stages. Implement lib/finance-cycle.js.
- [x] Add store boundary tests and implement single-cell read/write/readback checkpoint with existing shared lease in lib/google-sheets-finance-cycle-store.js. Avoid sequential per-field mutations.
- [x] Add report fixtures with hand-derived totals, refunds, payroll groups, missing revenue, invalid rows and source races. Implement lib/finance-reports.js and Sheets adapter.
- [x] Wire production route to real stages with existing auth; add actual route tests for manual/cron/OIDC recovery dispatch. Keep diagnostics/payment-only token behavior.
- [x] Make overall status depend on verified cycle and reports; test partial-cycle green-source case. Add bounded signed workflow continuation loop.
- [ ] Run full npm test, diff check, commit, push branch/PR, CI, merge and verify production stage continuation. Update durable audit with measured result and any concrete remaining blocker.

Checkpoint commands: `node --test test/finance-cycle.test.js test/finance-reports.test.js`; full gate `npm test`; release through GitHub PR only.

## Execution ledger
Tasks 1–3 complete at 47f42d7; 12 new tests passed and suite 1060/1060.
Tasks 4–5: production route, fail-closed owner/data-health consumers, all-day bounded recovery loop implemented; focused tests passed. Full-suite fixture updates in progress.
Ruling: run the existing owner action queue at the start of a normal intraday cycle only when a previous cycle completed, under the existing lease; never during recovery. This preserves processing without making a recovery execute owner actions. The initial migration waits for a verified cycle; queue work contributes to normal-start duration.
Ruling: recovery schedule covers all hours, including the nightly 21:30 UTC run; retaining the old 04–15 UTC window would leave nightly work unfinished until morning.
Ruling: overall cycle validity is exposed by authenticated data-health and owner-package readers; the legacy sheet retains its source-freshness snapshot. The snapshot alone must not be interpreted as cycle completion.
Ruling: a new full checkpoint supersedes the legacy two-stage retry slot without deleting its audit history; all source/publication work is included again. Existing payment-only diagnostics retain their original controller.

Final review: fresh reviewer found three Important issues; all reproduced RED then fixed GREEN: queued full request, stale report fingerprint through tail/current readers, blank/null/false/zero checkpoint corruption. Final suite: 1075/1075 passed, diff check clean. No deferred minors.
Ruling: an owner-queue exception is recorded as OWNER_QUEUE_FAILED without blocking the financial refresh, so a stale owner package cannot deadlock its own refresh. Recovery still never runs this queue.
Review scope limits: exact deployed Apps Script parity and real per-stage runtimes require production verification. Canonical dry run matched the previously verified reference month; no live finance records are committed to git.
Release destination verified read-only: existing GitHub repository miros2012/vector-ashk-vercel has homepage vector-ashk-backend.vercel.app and merged predecessor PR 277; Vercel production metadata links the same repository and base SHA. An initial git push was rejected by automatic approval review pending destination/publication verification. No release performed at that point.
