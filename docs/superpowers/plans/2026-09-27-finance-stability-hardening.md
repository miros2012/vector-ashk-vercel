# Finance Stability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound each finance request to one checkpointed stage and add a daily secretless production Owner Package monitor.

**Architecture:** Keep the existing Sheets checkpoint and OIDC trust model. Reduce the serverless request unit to one stage, then use a dedicated scheduled GitHub workflow whose exact identity is accepted by the existing smoke endpoint.

**Tech Stack:** Node.js 24, Vercel Functions, GitHub Actions OIDC, Google Sheets checkpoint store.

**Spec:** `docs/superpowers/specs/2026-09-27-finance-stability-hardening-design.md`

## Global Constraints

- Preserve fail-closed financial gates and do not modify business data.
- Add no shared secret.
- Use test-first changes and run the complete Node test suite.

## Review Focus

- Recovery must advance exactly one stage per HTTP request.
- Manual Owner smoke must retain its owner-only authorization.
- A scheduled token from the general hourly workflow must remain forbidden.
- Only the dedicated monitor workflow may use scheduled smoke authorization.
- Both smoke identities must fail on workflow/deployment SHA drift.

---

### Task 1: Bound finance recovery requests

**Files:**
- Modify: `api/nightly-finance-orchestrator.js`
- Test: `test/finance-cycle-route.test.js`

**Interfaces:**
- Consumes: `createFinanceCycleHandler({ maxStages })`.
- Produces: production recovery handlers configured with `maxStages: 1`.

- [ ] Add a route regression test proving one recovery request advances one checkpointed stage.
- [ ] Run it and confirm it fails because the current request drains multiple stages.
- [ ] Configure the production resumable handler to run one stage per invocation.
- [ ] Run the focused finance tests and confirm they pass.
- [ ] Commit the task.

### Task 2: Add daily OIDC production monitoring

**Files:**
- Create: `.github/workflows/owner-package-monitor.yml`
- Modify: `lib/owner-package-oidc-smoke.js`
- Modify: `test/owner-package-oidc-smoke.test.js`
- Modify: `test/owner-package-oidc-smoke-wiring.test.js`

**Interfaces:**
- Consumes: existing `POST /api/health` mode `owner_package_smoke` and GitHub OIDC verifier.
- Produces: exact scheduled monitor identity alongside the existing manual identity.

- [ ] Add failing authorization and workflow wiring tests for the dedicated scheduled identity.
- [ ] Run the tests and confirm failure because scheduled smoke is currently forbidden and the workflow is absent.
- [ ] Implement the exact dual-identity authorization and least-privilege daily workflow.
- [ ] Run focused OIDC and wiring tests.
- [ ] Run the complete test suite outside the network-restricted sandbox.
- [ ] Commit the task and perform a whole-branch review.

