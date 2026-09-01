# Owner Action UX + Decision Effectiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner see and execute the highest-priority active recommendation from `Панель собственника`, route all mutations through the existing backend execution API, and measure realized financial effect from immutable history.

**Architecture:** Add a read-only `/api/owner-action` view model over the existing `Решения` state, keep `/api/decision-event` as the only mutation primitive, and add a read-only effectiveness aggregate derived from `Решения` + `История решений`. The Google Sheet remains a presentation/control surface; no Rule Engine ownership changes are allowed.

**Tech Stack:** Node.js 20+, Vercel serverless functions, Google Sheets API via `googleapis`, existing Decision Execution Layer, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-01-owner-action-ux-design.md`

## Global Constraints

- Backend Rule Engine remains source of truth for H/J/M/P in `Решения`.
- Execution Layer remains source of truth for K/N/R:V and append-only `История решений`.
- `Панель собственника` must not directly mutate execution or rule-derived state.
- All mutations continue through `/api/decision-event` with requestId idempotency and expectedExecutionStatus concurrency checks.
- No standalone web dashboard, multi-tenant auth, storage migration, or new industry-specific rules in this stage.
- New read endpoints must never expose spreadsheet formulas, hidden rank fields, or secrets.

---

### Task 1: Owner Action Read Model

**Files:**
- Create: `lib/owner-action-view.js`
- Create: `lib/owner-action-sheet-adapter.js`
- Create: `test/owner-action-view.test.js`
- Create: `test/owner-action-sheet-adapter.test.js`

**Interfaces:**
- Produces: `buildOwnerActionView(decisions)` returning `{ top, activeCount }` where `top` is the highest-ranked active decision normalized for UI.
- Produces: `createOwnerActionSheetAdapter({ sheets, spreadsheetId }).readOwnerAction()` returning normalized decision rows without formulas.

- [ ] **Step 1: Write failing tests for ranking and allowed actions**

```js
const decisions = [
  { ruleId:'A', active:true, rank:2, executionStatus:'В работе', verificationStatus:'Не проверено' },
  { ruleId:'B', active:true, rank:1, executionStatus:'Не начато', verificationStatus:'Не проверено' }
];
const view = buildOwnerActionView(decisions);
assert.equal(view.top.ruleId, 'B');
assert.deepEqual(view.top.allowedActions, ['start']);
```

Also cover:
- `В работе` -> `['complete']`
- `Готово` + `Не проверено` -> `['verify_confirmed','verify_no_effect','verify_na']`
- inactive decisions are excluded
- no active decision returns `top:null`

- [ ] **Step 2: Run targeted tests and confirm RED**

Run: `node --test test/owner-action-view.test.js`
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement the minimal pure view builder**

Normalize only these UI fields:
`ruleId,title,deviation,recommendation,task,assignee,deadline,priority,executionStatus,verificationStatus,plannedEffect,actualEffect,linkedObject,lastResult,lastChecked,allowedActions`.

Sort active rows by numeric rank ascending, then due date ascending, then ruleId.

- [ ] **Step 4: Add sheet adapter tests and implementation**

Read bounded range `'Решения'!A2:V200` with `valueRenderOption:'UNFORMATTED_VALUE'` and map columns explicitly. Do not return rank or spreadsheet implementation fields from the public view.

- [ ] **Step 5: Run targeted tests and commit**

Run: `node --test test/owner-action-view.test.js test/owner-action-sheet-adapter.test.js`
Expected: PASS.

Commit message: `feat: add owner action read model`

---

### Task 2: Protected Read-Only Owner Action API

**Files:**
- Create: `lib/owner-action-api.js`
- Create: `api/owner-action.js`
- Create: `test/owner-action-api.test.js`
- Create: `test/owner-action-route.test.js`

**Interfaces:**
- Consumes: `createOwnerActionSheetAdapter(...).readOwnerAction()`
- Produces: `GET /api/owner-action` response `{ ok:true, top, activeCount, checkedAt }`

- [ ] **Step 1: Write failing API tests**

Cover:
- GET only, POST -> 405
- wrong/missing key -> 403 before any sheet read
- authorized GET returns normalized view
- `Cache-Control: no-store`
- endpoint output excludes `rank`, formulas, and sheet row numbers

- [ ] **Step 2: Confirm RED**

Run: `node --test test/owner-action-api.test.js test/owner-action-route.test.js`
Expected: FAIL because handler/route do not exist.

- [ ] **Step 3: Implement handler and route**

Use the same auth convention as `/api/decision-event`: `x-vector-key` or Bearer key, configured from `VECTOR_SYNC_KEY || TOCHKA_BRIDGE_KEY`. Route uses Google Sheets readonly scope.

- [ ] **Step 4: Run targeted tests and commit**

Expected: PASS.

Commit message: `feat: expose protected owner action view`

---

### Task 3: Decision Effectiveness Aggregates

**Files:**
- Create: `lib/decision-effectiveness.js`
- Create: `lib/decision-effectiveness-sheet-adapter.js`
- Create: `lib/decision-effectiveness-api.js`
- Create: `api/decision-effectiveness.js`
- Create: `test/decision-effectiveness.test.js`
- Create: `test/decision-effectiveness-api.test.js`

**Interfaces:**
- Produces: `calculateDecisionEffectiveness({ decisions, history, now })`
- Produces: `GET /api/decision-effectiveness` normalized aggregate.

- [ ] **Step 1: Write failing aggregate tests**

Given decisions/history, calculate exactly:
- recommendationCount
- startedCount / startRate
- completedCount / completionRate
- verifiedCount / verificationRate
- confirmedEffectCount
- totalConfirmedEffect
- averageTimeToStartHours
- averageTimeToCompleteHours
- averageTimeToVerifyHours
- effectRealizationRatio when planned/actual values are comparable

Use only immutable history timestamps for elapsed-time metrics. Ignore malformed/duplicate history event IDs defensively.

- [ ] **Step 2: Confirm RED**

Run: `node --test test/decision-effectiveness.test.js`
Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement minimal deterministic aggregator**

Do not write aggregates back into history. Treat confirmed verification events with numeric actualEffect as realized value.

- [ ] **Step 4: Add read adapter/API tests and implementation**

Read bounded ranges:
- `'Решения'!A2:V200`
- `'История решений'!A2:K1000`

Use readonly Google Sheets scope; protected GET-only endpoint; no-store response.

- [ ] **Step 5: Run targeted tests and commit**

Expected: PASS.

Commit message: `feat: add decision effectiveness metrics`

---

### Task 4: Owner Action Control Block in Google Sheets

**Files:**
- Modify existing spreadsheet `ДДС Вектор - тест полного импорта`, tab `Панель собственника`

**Interfaces:**
- Consumes backend-owned state already mirrored in `Решения`.
- Produces a presentation/control block containing top active decision, action choice, optional result/evidence/effect inputs, and request status fields.

- [ ] **Step 1: Read exact target area and validations**

Choose an unused bounded block on `Панель собственника`; inspect existing formatting and neighboring cells before edits.

- [ ] **Step 2: Create the display block**

Show:
- top decision/event
- reason/deviation
- recommendation/task
- deadline/priority
- planned risk/effect
- execution status
- verification status
- actual effect
- last result

Use formulas referencing `Решения` only for display; never mutate raw decision state.

- [ ] **Step 3: Create control inputs**

Add dropdowns for requested action derived from current execution state, plus result/evidence and actual-effect input cells. Add request-state cells with allowed values `READY/SENT/SUCCESS/ERROR`.

- [ ] **Step 4: Verify values, validation, and visual quality**

Re-read the authored range and confirm no unrelated dashboard cells changed.

---

### Task 5: Safe Request Queue Transport for Sheets v1

**Files:**
- Create: `lib/owner-action-request.js`
- Create: `lib/owner-action-request-sheet-adapter.js`
- Create: `api/owner-action-request.js`
- Create: `test/owner-action-request.test.js`
- Modify: `vercel.json` only if a daily/cron transport is needed; prefer event/poll-on-demand without new high-frequency cron.

**Interfaces:**
- Converts a dashboard request row into the existing decision-event command shape.
- Reuses `createDecisionExecutionHandler` semantics; does not introduce a second mutation state machine.

- [ ] **Step 1: Write failing normalization tests**

Map UI actions:
- `В работу` -> `{ action:'start' }`
- `Готово` -> `{ action:'complete', result, evidence }`
- `Подтвердить эффект` -> `{ action:'verify', verificationStatus:'Подтверждено', actualEffect }`
- `Нет эффекта` -> `{ action:'verify', verificationStatus:'Нет эффекта' }`
- `Не применимо` -> `{ action:'verify', verificationStatus:'Не применимо' }`

Every request must carry stable `requestId` and `expectedExecutionStatus`.

- [ ] **Step 2: Confirm RED and implement pure normalizer**

Validation failures must not mutate Sheets.

- [ ] **Step 3: Implement protected request endpoint**

Endpoint reads one pending control request, invokes the existing execution handler/service, then writes only transport status/result back to the control area. It must never write `Решения` or `История решений` directly.

- [ ] **Step 4: Add idempotency retry test**

Re-sending the same requestId returns success/idempotent without duplicate history event.

- [ ] **Step 5: Run targeted tests and commit**

Commit message: `feat: add owner action request transport`

---

### Task 6: Dashboard Effectiveness KPIs

**Files:**
- Modify existing spreadsheet `Панель собственника`

**Interfaces:**
- Uses execution state/history-derived metrics; does not own them.

- [ ] **Step 1: Add compact KPI row/block**

Display at minimum:
- active recommendations
- started / completed / verified
- verification rate
- confirmed effect count
- total confirmed financial effect

- [ ] **Step 2: Add owner-facing status copy**

Show whether the top recommendation is waiting for start, completion, or verification.

- [ ] **Step 3: Verify formatting and no overlap**

Re-read exact ranges and preserve existing dashboard style.

---

### Task 7: Full Regression, Production Release, and End-to-End Proof

**Files:**
- No new behavior unless a failing test reveals a defect.

**Interfaces:**
- Validates all previous tasks together.

- [ ] **Step 1: Run the full repository test suite**

Run: `npm test`
Expected: all tests PASS, 0 FAIL.

- [ ] **Step 2: Verify feature branch deploy policy**

No unintended Vercel Preview deployment for slash feature branch.

- [ ] **Step 3: Fast-forward main once and wait for one production deployment**

Do not force merge and do not trigger repeated deployments.

- [ ] **Step 4: Production smoke tests**

Verify:
- `/api/owner-action` auth + normalized top action
- `/api/decision-effectiveness` auth + aggregate
- existing `/api/decision-shadow-status` remains 4/4 drift 0
- existing Rule Engine reconciliation remains commit + verified 4/4

- [ ] **Step 5: Execute one controlled synthetic/test lifecycle if available**

Use a hidden synthetic test rule, not a real business decision, to prove:
`start → complete → verify → history append → actual effect → effectiveness aggregate`.
If no safe synthetic rule exists, do not mutate a real active rule; validate using unit/integration tests and the dashboard read path only.

- [ ] **Step 6: Update `AI Контролер` and dashboard status**

Record production state, safeguards, and next product step.
