# Finance Stage Retry Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the finance orchestrator record every receivables/ROP attempt, retry only a transiently failed stage, and keep verified receivables independent from ROP publication failures.

**Architecture:** Split the combined receivables hook into an idempotent `receivablesSource` stage and a separate `ropPublish` stage. Wrap those stages with a small, dependency-injected execution controller that owns safe error classification, a Google Sheets-backed attempt ledger, one durable retry slot, and a four-minute orchestration lease. Existing nightly and intraday pipelines remain the business-flow owners; they call the controller for normal or recovery execution and preserve the existing Data Health gate.

**Tech Stack:** Node.js 24 ESM, built-in `node:test`, Google Sheets API through `googleapis`, Vercel Functions/Cron.

**Spec:** `docs/superpowers/specs/2026-09-17-finance-stage-retry-ledger-design.md`

## Global Constraints

- Add no queue service, database, paid infrastructure, or new financial writer.
- Automatic durable retry is enabled only for `receivablesSource` and `ropPublish`.
- Retry attempt 2 is due after 10 minutes; attempt 3 is due after 30 minutes; no fourth automatic attempt.
- `ASHK_FETCH`, `SHEETS_WRITE`, `SHEETS_READBACK`, `ROP_PUBLISH`, and `TIME_BUDGET` are retryable.
- `READBACK_MISMATCH`, `ROP_BUILD`, `LEDGER_WRITE`, authentication/validation failures, and `UNCLASSIFIED` are permanent.
- Ledger rows contain stage metadata only; no financial values, names, contract rows, payment rows, provider bodies, secrets, or arbitrary exception messages.
- The finance lease is four minutes; a concurrent invocation returns HTTP 409 before stage work.
- Data Health remains the mandatory gate before Decision Engine and Owner Action processing.
- A failed invocation remains non-2xx even when downstream diagnostics safely complete.
- Do not inject faults into production and do not perform payments, transfers, bank-operation changes, or ambiguous classifications.

---

## File structure

- `lib/finance-stage-result.js`: allowlisted stage names/error classes, sanitized failure results, retryability policy.
- `lib/finance-retry-policy.js`: retry timing, pending-state normalization, recovery-stage selection.
- `lib/finance-run-ledger.js`: run IDs and exact ledger row serialization/validation.
- `lib/finance-run-control.js`: dependency-injected lease, attempt recording, retry scheduling, and stage execution controller.
- `lib/google-sheets-finance-run-store.js`: exact Google Sheets adapter for the hidden ledger and `__vercel_control` keys.
- `lib/receivables-sync-handler.js`: explicit source phase hooks and safe boundary-specific failures; no ROP publication.
- `lib/nightly-finance-orchestrator.js`: distinct `receivablesSource`/`ropPublish` stages and recovery-tail behavior.
- `lib/rop-intraday-orchestrator.js`: the same split plus Owner Action processing in intraday recovery.
- `api/nightly-finance-orchestrator.js`: production wiring, source marker timing, ledger/store construction, and lease lifecycle.
- Existing and new `test/*.test.js` files: behavior-first coverage for every component and production wiring.

### Task 1: Safe stage result contract

**Files:**
- Create: `lib/finance-stage-result.js`
- Create: `test/finance-stage-result.test.js`

**Interfaces:**
- Produces: `FINANCE_RETRYABLE_ERROR_CLASSES`, `sanitizeFinanceStageFailure({ stage, statusCode, errorClass })`, and `financeStageSuccess({ statusCode, body })`.
- `sanitizeFinanceStageFailure` returns `{ ok: false, statusCode, errorClass, retryable }` using only allowlisted classes and never copies an exception message.

- [ ] **Step 1: Write failing allowlist and sanitization tests**

```js
test('sanitizes a retryable stage failure without exposing the exception', () => {
  assert.deepEqual(sanitizeFinanceStageFailure({
    stage: 'receivablesSource', statusCode: 503, errorClass: 'ASHK_FETCH',
    error: new Error('student Иван api-key=secret')
  }), { ok: false, statusCode: 503, errorClass: 'ASHK_FETCH', retryable: true });
});

test('maps an unknown class to non-retryable UNCLASSIFIED', () => {
  assert.deepEqual(sanitizeFinanceStageFailure({
    stage: 'ropPublish', statusCode: 500, errorClass: 'SyntaxError'
  }), { ok: false, statusCode: 500, errorClass: 'UNCLASSIFIED', retryable: false });
});
```

- [ ] **Step 2: Run `node --test test/finance-stage-result.test.js` and verify RED because the module does not exist**

- [ ] **Step 3: Implement the allowlisted public result contract**

```js
const RETRYABLE = new Set(['ASHK_FETCH','SHEETS_WRITE','SHEETS_READBACK','ROP_PUBLISH','TIME_BUDGET']);
const PERMANENT = new Set(['READBACK_MISMATCH','ROP_BUILD','LEDGER_WRITE','AUTH','VALIDATION','UNCLASSIFIED']);

export function sanitizeFinanceStageFailure({ statusCode = 500, errorClass = 'UNCLASSIFIED' } = {}) {
  const normalized = RETRYABLE.has(errorClass) || PERMANENT.has(errorClass)
    ? errorClass : 'UNCLASSIFIED';
  return { ok: false, statusCode: Number(statusCode) || 500, errorClass: normalized, retryable: RETRYABLE.has(normalized) };
}
```

- [ ] **Step 4: Run `node --test test/finance-stage-result.test.js` and verify GREEN**

- [ ] **Step 5: Commit `lib/finance-stage-result.js` and its test as `feat: add safe finance stage results`**

### Task 2: Retry policy and ledger row model

**Files:**
- Create: `lib/finance-retry-policy.js`
- Create: `lib/finance-run-ledger.js`
- Create: `test/finance-retry-policy.test.js`
- Create: `test/finance-run-ledger.test.js`

**Interfaces:**
- Consumes: sanitized failure objects from Task 1.
- Produces: `nextFinanceRetry({ failure, attempt, now, runId, stage })`, `recoveryStages(stage, { includeOwnerActions })`, `createFinanceRunId(now, randomBytes)`, `FINANCE_LEDGER_HEADERS`, and `financeLedgerRow(entry)`.
- `nextFinanceRetry` returns `null` for permanent failures or attempt 3; otherwise exact control-state fields and ISO retry time.

- [ ] **Step 1: Write failing tests for 10-/30-minute timing and the attempt-3 stop**

```js
assert.equal(nextFinanceRetry({ failure: { retryable: true, errorClass: 'ASHK_FETCH' }, attempt: 1,
  now: new Date('2026-09-18T00:00:00.000Z'), runId: 'r1', stage: 'receivablesSource' }).finance_retry_after_utc,
  '2026-09-18T00:10:00.000Z');
assert.equal(nextFinanceRetry({ failure: { retryable: true, errorClass: 'ROP_PUBLISH' }, attempt: 2,
  now: new Date('2026-09-18T00:00:00.000Z'), runId: 'r1', stage: 'ropPublish' }).finance_retry_after_utc,
  '2026-09-18T00:30:00.000Z');
assert.equal(nextFinanceRetry({ failure: { retryable: true }, attempt: 3, now: new Date(), runId: 'r1', stage: 'ropPublish' }), null);
```

- [ ] **Step 2: Run both new test files and verify RED because the modules do not exist**

- [ ] **Step 3: Implement the retry delays and exact recovery stage lists**

```js
export function recoveryStages(stage, { includeOwnerActions = false } = {}) {
  const tail = ['dataHealth', 'decisions'];
  if (includeOwnerActions) tail.push('ownerActionQueue');
  if (stage === 'receivablesSource') return ['receivablesSource', 'ropPublish', ...tail];
  if (stage === 'ropPublish') return ['ropPublish', ...tail];
  return [];
}
```

- [ ] **Step 4: Implement the 13-column ledger serializer and reject payload-bearing fields**

```js
export const FINANCE_LEDGER_HEADERS = ['runId','startedAtUtc','finishedAtUtc','trigger','mode','stage','attempt','result','statusCode','errorClass','retryable','retryAfterUtc','deploymentSha'];

export function financeLedgerRow(entry) {
  if (!['SUCCESS','FAILED','SKIPPED','RECOVERED'].includes(entry.result)) throw new Error('invalid ledger result');
  return FINANCE_LEDGER_HEADERS.map(name => entry[name] ?? '');
}
```

- [ ] **Step 5: Run `node --test test/finance-retry-policy.test.js test/finance-run-ledger.test.js` and verify GREEN**

- [ ] **Step 6: Commit as `feat: define finance retry and ledger policy`**

### Task 3: Google Sheets durable store

**Files:**
- Create: `lib/google-sheets-finance-run-store.js`
- Create: `test/google-sheets-finance-run-store.test.js`

**Interfaces:**
- Consumes: `FINANCE_LEDGER_HEADERS` and `financeLedgerRow(entry)` from Task 2.
- Produces: `createGoogleSheetsFinanceRunStore({ sheets, spreadsheetId, ledgerSheet = 'Finance Run Ledger', controlSheet = '__vercel_control', now })`.
- Store methods: `ensureSchema()`, `appendAttempt(entry)`, `readRetry()`, `writeRetry(state)`, `clearRetry()`, `acquireLease({ runId, leaseMs })`, and `releaseLease({ runId })`.

- [ ] **Step 1: Write failing adapter tests with a Sheets fake**

```js
test('appendAttempt writes one 13-column row and verifies a unique attempt key', async () => {
  const store = createGoogleSheetsFinanceRunStore({ sheets, spreadsheetId: 'book' });
  await store.appendAttempt({ runId: 'r1', stage: 'ropPublish', attempt: 2, result: 'FAILED', statusCode: 502,
    errorClass: 'ROP_PUBLISH', retryable: true, startedAtUtc: 's', finishedAtUtc: 'f', trigger: 'cron', mode: 'intraday', retryAfterUtc: 'n', deploymentSha: 'sha' });
  assert.equal(fake.appended[0].length, 13);
  assert.equal(fake.readAttemptKeys.filter(key => key === 'r1:ropPublish:2').length, 1);
});
```

- [ ] **Step 2: Run `node --test test/google-sheets-finance-run-store.test.js` and verify RED**

- [ ] **Step 3: Implement `ensureSchema()` using metadata lookup, one hidden sheet creation/update, and exact header readback**

- [ ] **Step 4: Implement append-then-readback uniqueness for `runId:stage:attempt`; return `{ ok: false, errorClass: 'LEDGER_WRITE' }` on a write/readback failure without throwing raw text**

- [ ] **Step 5: Implement exact-key control reads/writes for the five retry keys and two lease values (`finance_orchestrator_lock`, `finance_orchestrator_lock_until_utc`) with readback verification**

- [ ] **Step 6: Implement compare-after-read lease acquisition: treat an unexpired foreign run ID as busy, overwrite only an expired/empty lease, and release only when the stored run ID equals the caller's run ID**

- [ ] **Step 7: Run the adapter test, then `node --test test/google-sheets-sync-marker.test.js test/google-sheets-finance-run-store.test.js`, and verify GREEN**

- [ ] **Step 8: Commit as `feat: add Sheets finance run store`**

### Task 4: Separate verified receivables from ROP publication

**Files:**
- Modify: `lib/receivables-sync-handler.js`
- Modify: `api/nightly-finance-orchestrator.js`
- Modify: `test/receivables-sync-handler.test.js`
- Modify: `test/receivables-after-verified.test.js`
- Modify: `test/nightly-finance-orchestrator-route.test.js`

**Interfaces:**
- Consumes: safe failure classes from Task 1.
- Produces: `createReceivablesSyncHandler({ ..., afterSourceVerified })`; successful response remains `{ ok: true, verified: true, ... }` but no longer contains `afterVerified` ROP output.
- `afterSourceVerified` receives `{ groups, contractsByGroup, summary }` and is wired only to advance `receivables_last_success_utc`.
- `refreshRopFromStagingAndPublish()` remains the distinct `ropPublish` callable.

- [ ] **Step 1: Replace the old hook tests with failing tests proving the marker hook runs after readback and ROP is not called by the source handler**

```js
test('verified receivables advances the source marker without publishing ROP', async () => {
  const calls = [];
  const handler = createReceivablesSyncHandler({ ...validDeps,
    afterSourceVerified: async () => calls.push('marker') });
  await handler({ method: 'GET' }, response);
  assert.deepEqual(calls, ['marker']);
  assert.equal('afterVerified' in response.body, false);
});
```

- [ ] **Step 2: Add failing boundary tests for `ASHK_FETCH`, `SHEETS_WRITE`, `SHEETS_READBACK`, and `READBACK_MISMATCH`; assert the response contains no thrown message**

- [ ] **Step 3: Run the three focused test files and verify RED on the new contract**

- [ ] **Step 4: Rename the hook, invoke it immediately after exact aggregate readback, and return sanitized boundary failures with 502 for transient I/O and mismatch**

- [ ] **Step 5: In API wiring, replace `syncRopDailyControlAndPublish` with `markReceivablesSourceVerified`; wire `afterSourceVerified` to the marker only and retain ROP rebuild exclusively in `refreshRopFromStagingAndPublish`**

- [ ] **Step 6: Run the focused tests and verify GREEN**

- [ ] **Step 7: Commit as `refactor: split receivables source from ROP publish`**

### Task 5: Attempt controller, lease, and durable retry scheduling

**Files:**
- Create: `lib/finance-run-control.js`
- Create: `test/finance-run-control.test.js`

**Interfaces:**
- Consumes: Tasks 1-3 and a store implementing Task 3.
- Produces: `createFinanceRunControl({ store, now, randomBytes, deploymentSha })` with `begin({ trigger, mode })`, `runStage(context, { stage, attempt, execute })`, `pendingRecovery(context)`, and `finish(context)`.
- `begin` acquires the four-minute lease and returns `{ ok: false, statusCode: 409 }` when busy.
- `runStage` appends one sanitized attempt row; on retryable failure it stores the next retry; ledger failure disables retry for that invocation.

- [ ] **Step 1: Write a failing concurrency test proving a busy lease calls no stage executor**

- [ ] **Step 2: Write failing tests proving attempt 1/2 schedule the exact retry and attempt 3/permanent/ledger failures clear or decline retry**

- [ ] **Step 3: Write a failing test proving a successful recovery is recorded as `RECOVERED` and clears retry only after ledger verification**

- [ ] **Step 4: Run `node --test test/finance-run-control.test.js` and verify RED**

- [ ] **Step 5: Implement the controller with dependency injection and `finally`-safe lease release; log only `{ stage, errorClass, attempt, retryable }`**

- [ ] **Step 6: Run the controller test and verify GREEN**

- [ ] **Step 7: Commit as `feat: add durable finance run control`**

### Task 6: Nightly normal and recovery flows

**Files:**
- Modify: `lib/nightly-finance-orchestrator.js`
- Modify: `test/nightly-finance-orchestrator.test.js`

**Interfaces:**
- Consumes: `runControl`, separate `runReceivablesSource`, and `runRopPublish` dependencies.
- Produces: normal stage keys `receivablesSource` and `ropPublish`; recovery response includes `mode: 'recovery'`, the retried stage, Data Health, and decisions.

- [ ] **Step 1: Add a failing normal-flow test expecting `receivablesSource` then `ropPublish`, and prove a ROP failure leaves `receivablesSource.ok === true`**

- [ ] **Step 2: Add a failing receivables recovery test expecting only `receivablesSource`, `ropPublish`, `dataHealth`, and `decisions`**

- [ ] **Step 3: Add a failing ROP recovery test expecting only `ropPublish`, `dataHealth`, and `decisions`**

- [ ] **Step 4: Add a failing recovery Data Health test proving decisions remain skipped**

- [ ] **Step 5: Add a failing 409 test proving an acquired foreign lease causes no child calls**

- [ ] **Step 6: Run the nightly test and verify RED**

- [ ] **Step 7: Implement the split normal flow and recovery dispatch while preserving existing independent-source refresh and non-2xx aggregation behavior**

- [ ] **Step 8: Run `node --test test/nightly-finance-orchestrator.test.js` and verify GREEN**

- [ ] **Step 9: Commit as `feat: recover failed nightly finance stages`**

### Task 7: Intraday normal and recovery flows

**Files:**
- Modify: `lib/rop-intraday-orchestrator.js`
- Modify: `test/rop-intraday-orchestrator.test.js`

**Interfaces:**
- Consumes: the same controller and split source/publish dependencies as Task 6.
- Produces: intraday recovery that includes Owner Action processing only after successful Data Health and verified Decision Engine reconciliation.

- [ ] **Step 1: Replace the obsolete “reuse ROP from receivables hook” test with a failing test expecting explicit source then publish calls**

- [ ] **Step 2: Add failing recovery tests for both retryable stages and assert hours, payments, Tochka, and balances are not rerun**

- [ ] **Step 3: Add a failing test proving Owner Action Queue runs after a successful recovery decision and never runs after Data Health/decision failure**

- [ ] **Step 4: Run the intraday test and verify RED**

- [ ] **Step 5: Implement the split stages and the restricted recovery tail**

- [ ] **Step 6: Run `node --test test/rop-intraday-orchestrator.test.js` and verify GREEN**

- [ ] **Step 7: Commit as `feat: recover failed intraday finance stages`**

### Task 8: Production wiring and deployment-safe schema provisioning

**Files:**
- Modify: `api/nightly-finance-orchestrator.js`
- Modify: `test/nightly-finance-orchestrator-route.test.js`
- Modify: `test/nightly-finance-runtime-import.test.js`
- Modify: `test/rop-intraday-wiring.test.js`
- Modify: `test/manual-finance-run-wiring.test.js`

**Interfaces:**
- Consumes: Tasks 3, 5, 6, and 7.
- Produces: one shared run-store factory per request, deployment SHA from `VERCEL_GIT_COMMIT_SHA`, trigger labels `cron|manual`, and mode labels `nightly|intraday`.

- [ ] **Step 1: Write failing wiring tests proving source and publish are separate dependencies, manual invocations share the lease, and deployment metadata—not business payload—is passed to the ledger**

- [ ] **Step 2: Run the four wiring/import tests and verify RED**

- [ ] **Step 3: Wire `createGoogleSheetsFinanceRunStore` and `createFinanceRunControl`; lazily call `ensureSchema()` after authentication but before lease acquisition**

- [ ] **Step 4: Wire `syncReceivables` as `receivablesSource`, `refreshRopFromStagingAndPublish` as `ropPublish`, and preserve existing route selection and one-time manual token semantics**

- [ ] **Step 5: Run the focused wiring/import tests and verify GREEN**

- [ ] **Step 6: Run `npm test` and require zero failures**

- [ ] **Step 7: Commit as `feat: wire durable finance stage recovery`**

### Task 9: Review, PR, production acceptance

**Files:**
- Modify only if review finds defects; every correction requires a new failing regression test first.

**Interfaces:**
- Consumes: completed Tasks 1-8.
- Produces: merged PR, READY production deployment, hidden ledger sheet/control keys, and readback evidence.

- [ ] **Step 1: Use `superpowers:requesting-code-review` for spec compliance and code-quality review; fix only validated findings through RED/GREEN tests**

- [ ] **Step 2: Run `git diff --check`, all focused finance tests, and `npm test`; capture exact pass counts**

- [ ] **Step 3: Create a PR describing the stage split, retry contract, concurrency guard, tests, and explicit non-goals**

- [ ] **Step 4: Wait for CI success, merge through the repository's normal protected workflow, and wait for the matching Vercel deployment to become `READY`**

- [ ] **Step 5: Provision or verify hidden `Finance Run Ledger` with exactly 13 headers and the five retry plus two lease control keys; read back metadata, headers, and key rows**

- [ ] **Step 6: Run one protected production finance cycle without fault injection and verify distinct successful `receivablesSource` and `ropPublish` ledger rows with the production SHA**

- [ ] **Step 7: Read back `receivables_last_success_utc`, Data Health, Decision Engine status, retry state, and released lease; confirm no payment, transfer, bank-operation, or ambiguous classification changes occurred**

- [ ] **Step 8: Report exact production evidence and any residual limitations; do not claim recovery-path production proof because intentional production failure injection is forbidden**
