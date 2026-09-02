# Master Payroll Verified Gross-to-Net Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a verified August 2026 master-payroll calculation that aggregates all confirmed ASHK work types, subtracts only individually evidenced payments/deductions, surfaces unresolved fuel/leasing blockers, and prevents `Фонд вождения` from switching before all gates are green.

**Architecture:** Keep payroll math in a pure domain module, source/evidence normalization in a separate module, and Sheet rendering/adaptation in a third module. The verified output remains diagnostic/staging until reconciliation gates pass; no new Vercel API route is added because the project is already at the Hobby function limit.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing Google Sheets adapters, ASHK archive data from `MasterWorkReportDetails`.

**Spec:** `docs/superpowers/specs/2026-09-02-master-payroll-verified-gross-net-design.md`

## Global Constraints

- August ASHK archive must remain `verification=OK` before promotion.
- Main driving: 383 RUB per academic hour.
- Extra B 120: 1,500 RUB per 3-academic-hour lesson.
- Extra B 90 legacy: 1,500 RUB per 2-academic-hour lesson.
- Internal city exam: 200 RUB per event/output, never per hour.
- Tsl: 574.50 RUB per 3-academic-hour lesson.
- Moto: 450 RUB per 2-academic-hour lesson.
- Extra moto: 650 RUB per 2-academic-hour lesson.
- Trainer: 150 RUB per 3-academic-hour lesson.
- Lesson-based types are paid by event count; hours are a control signal only.
- Fuel/leasing/company-wide vehicle costs must not reduce an individual master without authoritative allocation.
- Negative outstanding net must become `REVIEW_REQUIRED`, never an automatic debt.
- `Фонд вождения`, DDS, P&L, Owner Dashboard, payouts, and Decision Engine writes are unchanged until reconciliation gates pass.
- Add no permanent API route/function.

---

### Task 1: Pure verified-gross calculator

**Files:**
- Create: `lib/master-payroll-gross.js`
- Test: `test/master-payroll-gross.test.js`

**Interfaces:**
- Consumes: normalized ASHK work rows shaped as `{ employeeId, masterName, sessionTypeName, academicHours, eventKey }`.
- Produces: `calculateVerifiedGross(rows, rateModel)` returning `{ masters, totals, blockers }`.
- Produces: exported `MASTER_PAYROLL_RATE_MODEL` containing the confirmed August rate rules.

- [ ] **Step 1: Write the failing rate/unit tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateVerifiedGross, MASTER_PAYROLL_RATE_MODEL } from '../lib/master-payroll-gross.js';

test('internal exam is paid by event count, not academic hours', () => {
  const rows = [
    { employeeId: '1', masterName: 'Master A', sessionTypeName: 'Внутренний экзамен город', academicHours: 2, eventKey: 'e1' }
  ];
  const result = calculateVerifiedGross(rows, MASTER_PAYROLL_RATE_MODEL);
  assert.equal(result.totals.gross, 200);
});

test('moto, extra moto and trainer use confirmed per-lesson rates', () => {
  const rows = [
    { employeeId: '1', masterName: 'Master A', sessionTypeName: 'Мото', academicHours: 2, eventKey: 'm1' },
    { employeeId: '1', masterName: 'Master A', sessionTypeName: 'Дополнительное вождение МОТО', academicHours: 2, eventKey: 'm2' },
    { employeeId: '1', masterName: 'Master A', sessionTypeName: 'Тренажер', academicHours: 3, eventKey: 't1' }
  ];
  const result = calculateVerifiedGross(rows, MASTER_PAYROLL_RATE_MODEL);
  assert.equal(result.totals.gross, 1250);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- test/master-payroll-gross.test.js`

Expected: FAIL because `lib/master-payroll-gross.js` does not exist.

- [ ] **Step 3: Implement the minimal calculator**

Implement a declarative rate model with these strategies:

```js
export const MASTER_PAYROLL_RATE_MODEL = {
  'Основное вождение (120 минут)': { mode: 'hour', rate: 383 },
  'Основное вождение (160 минут)': { mode: 'hour', rate: 383 },
  'Доп. часы кат В (120 минут)': { mode: 'event', rate: 1500 },
  'Доп часы кат.В (90 минут)': { mode: 'event', rate: 1500 },
  'Внутренний экзамен город': { mode: 'event', rate: 200 },
  Tsl: { mode: 'event', rate: 574.5 },
  'Мото': { mode: 'event', rate: 450 },
  'Дополнительное вождение МОТО': { mode: 'event', rate: 650 },
  'Тренажер': { mode: 'event', rate: 150 }
};
```

`calculateVerifiedGross()` must aggregate by employee id, preserve per-type event/hour counts, and add unknown session types to `blockers` rather than silently paying them.

- [ ] **Step 4: Add B-regression tests**

Add fixtures proving:
- 4,260 main hours -> 1,631,580 RUB.
- 1,561 Extra B 120 hours represented as 521 full 3h events plus the archive's actual event rows are paid by event count, not by dividing total hours blindly.
- 188 internal-exam events with 189 hours -> 37,600 RUB.
- unknown type -> blocker and no promoted gross.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test -- test/master-payroll-gross.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/master-payroll-gross.js test/master-payroll-gross.test.js
git commit -m "feat: add verified master gross calculator"
```

---

### Task 2: Payment/deduction evidence normalization

**Files:**
- Create: `lib/master-payroll-evidence.js`
- Test: `test/master-payroll-evidence.test.js`

**Interfaces:**
- Consumes: DDS evidence rows shaped as `{ sourceId, date, amount, counterparty, description, article }`.
- Produces: `normalizePayrollEvidence(rows, aliases)` -> `{ confirmed, blocked }`.
- Confirmed items use `{ masterKey, type, amount, sourceId, status: 'CONFIRMED' }`.

- [ ] **Step 1: Write failing evidence tests**

```js
test('confirmed individual advance reduces only named master', () => {
  const rows = [{
    sourceId: 'dds-13372',
    date: '2026-08-06',
    amount: 30000,
    counterparty: 'Козлов',
    description: 'Выплата аванса по заработной плате сотруднику (Козлов)',
    article: 'Зарплата мастеров'
  }];
  const result = normalizePayrollEvidence(rows, { козлов: 'kozlov-ivan' });
  assert.deepEqual(result.confirmed[0], {
    masterKey: 'kozlov-ivan',
    type: 'ADVANCE',
    amount: 30000,
    sourceId: 'dds-13372',
    status: 'CONFIRMED'
  });
});

test('generic fuel payment remains blocked', () => {
  const rows = [{ sourceId: 'fuel-1', amount: 50000, counterparty: 'Газпромнефть', description: 'ГСМ', article: 'Топливо' }];
  const result = normalizePayrollEvidence(rows, {});
  assert.equal(result.confirmed.length, 0);
  assert.equal(result.blocked[0].reason, 'NO_MASTER_ALLOCATION');
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- test/master-payroll-evidence.test.js`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement evidence classification**

Support only these confirmed types:
- `ADVANCE`
- `OFFICIAL_PAYMENT`
- `STATUTORY_DEDUCTION`
- `OTHER_CONFIRMED_INDIVIDUAL`

Treat fuel, leasing, generic car costs, and pooled contractor/master payments as `blocked` unless an explicit master key is present in authoritative input.

- [ ] **Step 4: Add current-August source fixtures**

Add tests for these known evidence patterns:
- Kозлов 30,000 RUB personal advance.
- Kозлов 13,166 RUB formal advance through another beneficiary.
- Kозлов executive deductions 13,583.35 + 6,790.65 RUB.
- Аталыков 7,825.68 advance + 8,017.92 salary + 13,496.40 statutory deduction.
- Ходаков 13,167 advance + 14,847 official salary.
- Толстоухов 12,931.75 advance + 14,582.25 official salary.
- pooled/generic payments to intermediaries remain blocked unless registry-backed.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- test/master-payroll-evidence.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/master-payroll-evidence.js test/master-payroll-evidence.test.js
git commit -m "feat: normalize master payroll evidence"
```

---

### Task 3: Gross-to-net reconciliation and promotion gates

**Files:**
- Create: `lib/master-payroll-reconciliation.js`
- Test: `test/master-payroll-reconciliation.test.js`

**Interfaces:**
- Consumes: `calculateVerifiedGross()` result and `normalizePayrollEvidence()` result.
- Produces: `reconcileMasterPayroll({ gross, evidence, requiredBlockedTypes })` -> `{ masters, totals, gates, promotionStatus }`.

- [ ] **Step 1: Write failing reconciliation tests**

```js
test('negative outstanding net is REVIEW_REQUIRED', () => {
  const result = reconcileMasterPayroll({
    gross: { masters: [{ masterKey: 'a', gross: 10000 }], blockers: [] },
    evidence: { confirmed: [{ masterKey: 'a', type: 'ADVANCE', amount: 12000, sourceId: 'x', status: 'CONFIRMED' }], blocked: [] },
    requiredBlockedTypes: []
  });
  assert.equal(result.masters[0].status, 'REVIEW_REQUIRED');
  assert.equal(result.promotionStatus, 'BLOCKED');
});

test('unallocated fuel blocks final promotion without reducing net', () => {
  const result = reconcileMasterPayroll({
    gross: { masters: [{ masterKey: 'a', gross: 10000 }], blockers: [] },
    evidence: { confirmed: [], blocked: [{ type: 'FUEL', amount: 3000, reason: 'NO_MASTER_ALLOCATION' }] },
    requiredBlockedTypes: ['FUEL']
  });
  assert.equal(result.masters[0].outstandingNet, 10000);
  assert.equal(result.promotionStatus, 'BLOCKED');
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- test/master-payroll-reconciliation.test.js`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement reconciler and explicit gates**

Gate names must be stable strings:
- `ASHK_ARCHIVE_OK`
- `ALL_SESSION_TYPES_RATED`
- `PER_MASTER_EQUALS_AGGREGATE`
- `EVENT_BASED_RULES_OK`
- `EVIDENCE_RECONCILED`
- `NO_UNEXPLAINED_NEGATIVE_NET`
- `VEHICLE_ALLOCATIONS_RESOLVED_OR_EXCLUDED`
- `EXISTING_PAYOUTS_RECONCILED`

`promotionStatus` is `READY` only if every gate is true; otherwise `BLOCKED`.

- [ ] **Step 4: Add aggregate invariants**

Test that:
- sum per-master gross equals aggregate gross;
- sum confirmed deductions equals aggregate deduction total;
- outstanding net equals gross minus confirmed evidence only;
- blocked amounts are reported but excluded from arithmetic.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- test/master-payroll-reconciliation.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/master-payroll-reconciliation.js test/master-payroll-reconciliation.test.js
git commit -m "feat: add master payroll reconciliation gates"
```

---

### Task 4: Google Sheets staging renderer

**Files:**
- Create: `lib/master-payroll-sheet-adapter.js`
- Test: `test/master-payroll-sheet-adapter.test.js`
- Modify only if reuse is needed: existing Google Sheets utility module discovered during implementation.

**Interfaces:**
- Consumes: reconciliation result from Task 3.
- Produces: `buildMasterPayrollSheetValues(result)` returning a 2D values array suitable for a bounded staging write.
- Does not write `Фонд вождения`.

- [ ] **Step 1: Write failing rendering test**

```js
test('sheet output separates full gross, confirmed deductions, blocked vehicle costs and net', () => {
  const rows = buildMasterPayrollSheetValues({
    masters: [{ masterName: 'Master A', gross: 50000, confirmedDeductions: 10000, outstandingNet: 40000, status: 'INTERIM' }],
    totals: { gross: 50000, confirmedDeductions: 10000, outstandingNet: 40000 },
    gates: { VEHICLE_ALLOCATIONS_RESOLVED_OR_EXCLUDED: false },
    promotionStatus: 'BLOCKED'
  });
  assert.deepEqual(rows[0].slice(0, 5), ['Мастер', 'Verified gross', 'Подтверждено удержаний/выплат', 'Outstanding net', 'Статус']);
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- test/master-payroll-sheet-adapter.test.js`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement deterministic staging matrix**

Output must include:
- master name/id;
- B gross;
- moto gross;
- extra-moto gross;
- trainer gross;
- total verified gross;
- advances;
- official payments;
- statutory deductions;
- other confirmed deductions;
- unresolved fuel;
- unresolved leasing;
- outstanding net;
- status;
- aggregate row;
- gate summary block.

- [ ] **Step 4: Verify no production-sheet target exists in adapter**

Add an assertion that adapter exports no `Фонд вождения` sheet name and contains no automatic promotion/write decision.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- test/master-payroll-sheet-adapter.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/master-payroll-sheet-adapter.js test/master-payroll-sheet-adapter.test.js
git commit -m "feat: render verified master payroll staging"
```

---

### Task 5: August archive regression fixture and live staging update

**Files:**
- Create: `test/fixtures/master-payroll-august-2026.json` with a compact fixture generated from verified source rows, not hand-authored aggregate-only data.
- Create: `test/master-payroll-august-regression.test.js`
- Modify: `АШК_Расчет_мастеров__staging` via Google Sheets bounded write after all tests pass.

**Interfaces:**
- Consumes: verified August archive plus confirmed DDS evidence rows.
- Produces: tested aggregate output and a new clearly labeled `VERIFIED FULL GROSS / NET` section in staging.

- [ ] **Step 1: Write regression test against verified controls**

The regression must assert:
- archive rows = 2,734;
- academic hours = 7,501;
- B gross = 2,474,542.50 RUB;
- moto gross = `moto event count * 450`;
- extra-moto gross = `extra-moto event count * 650`;
- trainer gross = `trainer event count * 150`;
- full gross equals B + moto + extra-moto + trainer;
- per-master sum equals aggregate full gross.

- [ ] **Step 2: Run RED with fixture absent/incomplete**

Run: `npm test -- test/master-payroll-august-regression.test.js`

Expected: FAIL until fixture and calculation are wired.

- [ ] **Step 3: Populate compact fixture from the verified archive**

Preserve one row per ASHK work event with employee id, name, session type, academic hours, and stable event key. Do not collapse lesson-based types into only total hours because payroll is event-based.

- [ ] **Step 4: Run all payroll tests**

Run: `npm test -- test/master-payroll-gross.test.js test/master-payroll-evidence.test.js test/master-payroll-reconciliation.test.js test/master-payroll-sheet-adapter.test.js test/master-payroll-august-regression.test.js`

Expected: PASS.

- [ ] **Step 5: Run full repository suite**

Run: `npm test`

Expected: all existing and new tests PASS with no warnings/errors.

- [ ] **Step 6: Write the verified staging block only**

Write the tested output to a new bounded section in `АШК_Расчет_мастеров__staging`, preserving the current interim block for audit history. Label promotion state explicitly `BLOCKED` until fuel/leasing and existing payouts are resolved/excluded.

- [ ] **Step 7: Re-read Sheet values and reconcile totals**

Verify the Sheet output exactly equals the tested values for:
- full gross;
- confirmed deductions/payments;
- outstanding net;
- gate statuses.

- [ ] **Step 8: Commit fixture/tests**

```bash
git add test/fixtures/master-payroll-august-2026.json test/master-payroll-august-regression.test.js
git commit -m "test: lock august master payroll regression"
```

---

### Task 6: Final verification and downstream decision gate

**Files:**
- No production formula changes unless the reconciliation result is `READY` and owner approves downstream promotion.
- Update documentation only if implementation reveals a rule difference from the approved spec.

**Interfaces:**
- Consumes: verified staging output and live balances/evidence.
- Produces: a documented decision: `BLOCKED` with exact blockers, or `READY_FOR_OWNER_APPROVAL` for `Фонд вождения` promotion.

- [ ] **Step 1: Verify all source controls live**

Confirm August archive still reports 2,734 rows / 7,501 hours / verification OK and business timezone Asia/Yekaterinburg.

- [ ] **Step 2: Verify all reconciliation gates**

Re-read staging gate block and ensure every gate has an evidence-backed state. No silent defaults.

- [ ] **Step 3: Verify `Фонд вождения` remains unchanged**

Read the current production fund sheet before and after implementation and confirm no write occurred.

- [ ] **Step 4: Run full tests one final time**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Review diff before PR**

Ensure changed files are limited to payroll domain/evidence/reconciliation/sheet adapter/tests/fixtures/docs; no new `api/*.js`, no `vercel.json` cron/function changes, no Decision Engine behavior changes.

- [ ] **Step 6: Request code review**

Use `superpowers:requesting-code-review` on the complete branch and address issues with `superpowers:receiving-code-review`.

- [ ] **Step 7: Run verification-before-completion**

Use `superpowers:verification-before-completion`; record exact test output and live Sheet controls before claiming completion.

- [ ] **Step 8: Open PR**

PR title: `feat: verified full master payroll gross-to-net`

PR body must state explicitly:
- full gross includes B + moto + extra moto + trainer;
- rates are owner-confirmed 2026-09-02;
- evidence-only deductions;
- fuel/leasing remain blocked unless authoritatively allocated;
- `Фонд вождения` not changed by this PR.
