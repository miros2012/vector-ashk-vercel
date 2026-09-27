# Finance Recovery Stability Implementation Plan

> Execute against `docs/superpowers/specs/2026-09-22-finance-cycle-design.md`. Preserve the one-external-stage-per-HTTP-call invariant.

**Goal:** Reduce stale ASHK/ROP data caused by missed GitHub schedules, without adding paid infrastructure or allowing one Vercel request to run several external stages.

**Design:** Move the tested recovery loop out of workflow YAML into one reusable Node worker. Keep the ten-minute dedicated recovery workflow and add an independent hourly recovery path to the already-authorized hourly workflow. Both paths obtain a fresh GitHub OIDC token for every stage and stop safely on leases, cooldowns, completion, or bounded failures.

## Task 1: Extract the recovery worker

- Add behavioral tests for stage draining, fresh OIDC tokens, bounded retries, cooldowns, lease contention, and Sheets quota spacing.
- Implement `scripts/finance-recovery-worker.mjs` with dependency injection for tests and a CLI entry point for Actions.
- Keep transport and source retry rules equivalent to the existing production workflow.

## Task 2: Wire two independent schedulers

- Replace the inline script in `.github/workflows/finance-recovery.yml` with the reusable worker.
- Add an hourly recovery job to `.github/workflows/hourly-project-continuation.yml` for the existing `23 * * * *` event.
- Give only the recovery jobs `id-token: write`; checkout without persisted credentials.
- Extend workflow contract tests to require both recovery paths.

## Task 3: Verify and release

- Run targeted tests, the full test suite, and workflow syntax checks.
- Review the diff for security and reliability regressions.
- Push, open a pull request, wait for CI, merge, verify deployment, then run/observe recovery until the live finance cycle completes.
