# Final v1 Intraday Decision Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every successful working-day finance refresh finish with verified Data Health, Decision Engine reconciliation, and Owner Action Queue processing so production decision state cannot remain stale until the nightly run.

**Architecture:** Extend the existing intraday orchestrator rather than adding routes, functions, or crons. Reuse the existing Data Health handler, protected decision-state synchronizer, and Owner Action Queue processor. Treat reconciliation as production-successful only when it is commit-mode, post-write verified, and fully matched. Preserve all existing fail-closed write/rollback controls and all financial safety policies.

**Tech Stack:** Node.js 24, ES modules, `node:test`, Google Sheets API, Vercel Functions/Cron.

**Spec:** `docs/superpowers/specs/2026-09-09-final-v1-intraday-decision-sync-design.md`

## Global Constraints

- No payments, transfers, bank mutations, or new financial-fact writes.
- No new public API route, Vercel function, or cron schedule.
- Do not weaken Data Health, Owner security, Decision Engine rollback, safe-withdrawal policy, Driving Fund formula, 550,000 RUB operating reserve, or 300,000 RUB forecast safety reserve.
- Decision reconciliation may only update the already-owned decision state fields protected by the existing backup/write/verify/rollback path.
- Owner Action Queue may only process its existing lifecycle/control commands.
- All production merges use the existing branch → RED → GREEN → full suite → diff review → PR → merge-ref CI → expected-SHA merge → post-merge CI → exact-SHA Vercel verification sequence.

---

## Task 1: Lock the full intraday stage contract with RED tests

**Files:**
- Modify: `test/rop-intraday-orchestrator.test.js`
- Modify: `test/tochka-dds-orchestrator-stage.test.js`

- [ ] Add a success test that records exact call order: payments → ROP → TochkaDDS → balances → DataHealth → decisions → OwnerActionQueue.
- [ ] Require successful decision stage body to be `mode: 'commit'`, `verified: true`, and `matches === total`.
- [ ] Add fail-closed Data Health test: downstream decisions and queue are skipped.
- [ ] Add reconciliation contract tests for dry-run, unverified commit, and post-reconcile drift; each must fail the intraday run and skip Owner Action Queue.
- [ ] Add Owner Action Queue failure test showing verified reconciliation remains reported but the final intraday result fails.
- [ ] Update earlier intraday fixtures so every constructed production-shaped orchestrator supplies the new downstream stages.
- [ ] Run only the targeted intraday tests and verify the new expectations fail against current production code for the expected missing-stage reason.
- [ ] Commit the RED tests.

## Task 2: Extend the intraday orchestrator with fail-closed downstream stages

**Files:**
- Modify: `lib/rop-intraday-orchestrator.js`
- Test: `test/rop-intraday-orchestrator.test.js`
- Test: `test/tochka-dds-orchestrator-stage.test.js`

- [ ] Require `runDataHealth`, `runDecisions`, and `runOwnerActionQueue` functions in the orchestrator constructor.
- [ ] Extend skipped-stage reporting so every upstream failure explicitly skips Data Health, decisions, and Owner Action Queue as applicable.
- [ ] After a successful balance stage, invoke Data Health through the existing authenticated child-handler path.
- [ ] If Data Health fails, stop before any decision write and report skipped decision/queue stages.
- [ ] Invoke Decision Reconcile through the existing authenticated child-handler path.
- [ ] Validate reconciliation body with one small helper: successful only for commit + verified + finite `matches`/`total` + exact equality.
- [ ] Treat a dry-run, unverified result, or mismatch as a 502 intraday-stage failure and skip Owner Action Queue.
- [ ] Invoke Owner Action Queue only after verified decision reconciliation; treat a non-OK queue result as the final 502 stage failure.
- [ ] Preserve the existing successful ROP/TochkaDDS/balance results in the returned stage map.
- [ ] Run targeted tests until GREEN.
- [ ] Commit the minimal orchestrator implementation.

## Task 3: Reuse the existing Owner Action Queue processor and wire production intraday

**Files:**
- Modify: `api/balances.js`
- Modify: `api/nightly-finance-orchestrator.js`
- Modify: `test/rop-intraday-wiring.test.js`

- [ ] Export the existing internal `processOwnerActionQueue(sheets)` helper from `api/balances.js`; do not create a new route or change its behavior.
- [ ] Add a small internal no-argument queue runner in `api/nightly-finance-orchestrator.js` that calls `processOwnerActionQueue(await getSheets())`.
- [ ] Wire `reconcileDecisions.dataHealth` as `runDataHealth`.
- [ ] Wire `reconcileDecisions` as `runDecisions`.
- [ ] Wire the internal queue runner as `runOwnerActionQueue`.
- [ ] Extend static wiring tests to prove all three stages are present on the intraday construction and that no new cron/function is added.
- [ ] Run targeted wiring + orchestrator tests.
- [ ] Commit production wiring.

## Task 4: Full verification and PR gate

**Files:**
- No intended production files beyond Tasks 2–3.

- [ ] Run API entrypoint syntax check using the repository's existing CI command.
- [ ] Run the complete Node test suite and require 0 failures.
- [ ] Compare branch against the fresh `main`; expected scope is spec/plan docs plus intraday orchestrator, two existing API files, and relevant tests only.
- [ ] Recheck open PRs/issues and fresh `main` before PR creation.
- [ ] Open one final v1 PR with RED/GREEN evidence and explicit non-goals.
- [ ] Require the pull-request merge-ref CI to pass on the exact head/base.
- [ ] Recheck PR head and main, then squash-merge using `expected_head_sha`.
- [ ] Require post-merge `main` CI to pass.

## Task 5: Exact-SHA production acceptance

**Files:**
- Read-only production verification; no planned code changes.

- [ ] Wait for Vercel production deployment whose Git SHA equals the merged `main` SHA and require `READY` with canonical alias.
- [ ] Verify canonical `/api/health` remains healthy and protected Owner route behavior remains fail-closed for unauthenticated access.
- [ ] Let/trigger one real scheduled intraday cycle after deployment; do not fabricate a finance run or bypass cron authentication.
- [ ] Inspect runtime evidence that the cycle reached balances, Data Health, Decision Reconcile, and Owner Action Queue.
- [ ] Require Decision Reconcile result: `mode=commit`, `verified=true`, `matches=total`.
- [ ] Query `/api/decision-shadow-status` and require `MATCH` / drift 0.
- [ ] Read the `Решения` sheet and confirm formerly stale decision rows now reflect current source facts.
- [ ] Read `Owner Action Queue` and confirm no pending acceptance artifact was introduced.
- [ ] Re-run Owner package production smoke only if the changed flow or acceptance evidence creates a reason to revalidate it; otherwise verify its untouched tests/security contract from CI and canonical protected-route behavior.

## Task 6: Close v1 with an operating runbook

**Files:**
- Create: `docs/V1_RUNBOOK.md`

- [ ] Document source refresh order, Data Health gate, Decision Reconcile success contract, rollback behavior, Owner Action Queue lifecycle, operating reserve change procedure, manual Tochka classification procedure, and what `safeWithdrawal=0` means when reserve is defined.
- [ ] State that business warnings such as a Driving Fund deficit are valid outputs, not software defects.
- [ ] State the boundaries: no automatic payments/transfers and no automatic classification of ambiguous operations.
- [ ] Add the final production SHA, CI run IDs, Vercel deployment ID, and acceptance timestamp after evidence exists.
- [ ] Commit the runbook only after production acceptance so it records verified final facts.
- [ ] If every acceptance item above is green, declare the current `ВЕКТОР — ФИНСИСТЕМА / API` scope **v1 complete**; any further features move to a post-v1 roadmap.
