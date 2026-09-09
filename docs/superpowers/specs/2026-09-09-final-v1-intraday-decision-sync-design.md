# Final v1 Intraday Decision Sync Design

## Goal

Close the last known v1 architecture gap: during the working day, fresh payments, ROP data, Tochka→DDS coverage, and balances must be followed by fresh Data Health, Decision Engine reconciliation, and Owner Action Queue processing. A successful intraday finance cycle must not leave the `Решения` sheet stale until the next nightly run.

## Current proven problem

Production `GET /api/decision-shadow-status` reports `DRIFT` with 1 match out of 4 rules. The current `Решения` sheet contains stale active decision state even though the underlying financial facts have changed.

The intraday path currently runs:

`Payments → ROP → Tochka→DDS → Balances`

and stops there. The balance stage used by intraday is intentionally mirror-only, so it does not reconcile decisions. The full nightly path can run Data Health and Decision Engine, but it may be blocked before that stage and only runs once per night. Therefore decision state can remain stale throughout the working day.

## Safe withdrawal is not part of this defect

`safeWithdrawal = 0` is currently a valid result, not a technical bug. The live driving-fund deficit is approximately 2.334 million RUB, the approved operating reserve is 550,000 RUB, and available cash is about 497,000 RUB. The safe-withdrawal policy correctly protects these needs through `LIQUIDITY_CAP`. This project stage must not weaken the withdrawal policy, driving-fund formula, operating reserve, or 300,000 RUB forecast safety reserve.

## Target intraday flow

After the existing successful balance mirror stage, the intraday orchestrator must continue with:

`Payments → ROP → Tochka→DDS → Balances → Data Health → Decision Reconcile → Owner Action Queue`

No new public API route or new cron schedule is required.

## Stage contracts

### Data Health

Use the existing finance Data Health handler/logic. If Data Health is not healthy enough to proceed, Decision Reconcile and Owner Action Queue are skipped. No decision state write is allowed after a failed Data Health gate.

### Decision Reconcile

Use the existing protected decision-state synchronizer. Production reconciliation is accepted only when all of the following are true:

- HTTP/body stage is successful;
- `mode = commit`;
- `verified = true`;
- `matches = total` after reconciliation.

A successful dry-run response is not sufficient for production readiness.

The existing write safety remains mandatory:

- formula backup before owned-field write;
- atomic backend-owned state update;
- post-write shadow verification;
- rollback on write failure or post-write mismatch.

### Owner Action Queue

After verified Decision Reconcile, process the existing Owner Action Queue using its existing lifecycle command path. This may update decision lifecycle/control fields but must not perform payments, transfers, bank mutations, or create new financial facts.

If Decision Reconcile is not verified, Owner Action Queue is skipped.

## Failure semantics

Each stage must be visible in the intraday response under `stages`.

- A failure in Payments or ROP skips all later stages.
- A failure in Tochka→DDS skips Balances, Data Health, Decision Reconcile, and Owner Action Queue.
- A failure in Balances skips Data Health, Decision Reconcile, and Owner Action Queue.
- A failed Data Health gate skips Decision Reconcile and Owner Action Queue.
- A non-commit, unverified, or drifted Decision Reconcile is treated as failure and skips Owner Action Queue.
- Owner Action Queue failure is reported as the final stage failure; it must not undo an already verified Decision Reconcile.

No stage may fabricate success for a skipped downstream stage.

## Production acceptance

After merge and exact-SHA deployment, v1 acceptance requires:

1. Full automated test suite passes on branch, PR merge-ref, and post-merge `main`.
2. Exact-SHA Vercel production deployment is `READY` and canonical alias points to it.
3. A real intraday cycle reaches the new Data Health, Decision Reconcile, and Owner Action Queue stages.
4. Decision Reconcile reports commit + verified + matches=total.
5. `GET /api/decision-shadow-status` reports `MATCH` with drift 0.
6. The stale `Решения` rows reflect the current source facts after reconciliation.
7. Owner Action Queue contains no unprocessed test artifact introduced by acceptance and no bank/payment action is executed.
8. Existing Owner package security and safe-withdrawal protections remain unchanged.

## Non-goals

This stage does not:

- weaken Data Health;
- change payroll or Driving Fund rates/formulas;
- change the approved 550,000 RUB operating reserve;
- change the 300,000 RUB forecast safety reserve;
- change safe-withdrawal formulas merely to produce a positive number;
- create or classify Tochka operations;
- write new DDS, obligations, or other factual financial-register rows;
- conduct payments/transfers or mutate bank operations;
- add a new public API route, Vercel function, or cron schedule;
- expand the project into AI Trading Desk or the public AI CFO product.

## Completion rule

Once the production acceptance above is green and the runbook documents the operating procedure, this architecture gap is considered closed and the current `ВЕКТОР — ФИНСИСТЕМА / API` scope is eligible to be declared v1 complete. Further product enhancements belong to a post-v1 roadmap, not to v1 completion.
