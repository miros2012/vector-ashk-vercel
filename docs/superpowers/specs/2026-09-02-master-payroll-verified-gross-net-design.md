# Verified master payroll gross-to-net design

Date: 2026-09-02
Status: implemented on feature branch; downstream promotion BLOCKED pending reconciliation gates
Scope: August 2026 master payroll verification and downstream driving-fund control

## Goal

Replace the unsafe category-B-only payroll control with a full verified master payroll chain:

ASHK work events -> verified gross by work type -> confirmed prior payments/deductions -> unresolved allocations -> final net -> driving fund reserve/update.

No production payout, `Фонд вождения`, DDS, P&L, or owner dashboard value may be switched to the new payroll result until the final reconciliation gates pass.

## Current verified source

Official work-event source: `GET /api/MasterWorkReportDetails`, BuildMode=1 / byTrainingHourType.

August archive control, re-read live during implementation:
- 2,734 rows
- 7,501 academic hours
- verification = OK
- business timezone = Asia/Yekaterinburg
- observed archive LoadedAt = 2026-09-02T04:13:09.739Z

The previous category-B control of 2,474,542.50 RUB was hour-equivalent and remains historical only. The approved event-based rule produces corrected category-B gross of **2,475,542.50 RUB**. The 1,000 RUB difference comes from `Доп. часы кат В (120 минут)`: 521 events but 1,561 academic hours. Payroll is 521 x 1,500 RUB, not 1,561 x 500 RUB.

## Confirmed rate model

Rates are confirmed by the owner on 2026-09-02.

| Work type | Pay unit | Confirmed rate | Equivalent hourly control |
|---|---:|---:|---:|
| Main driving 120/160 | academic hour | 383 RUB / acad h | 383 RUB / acad h |
| Extra B 120 | lesson/event | 1,500 RUB / lesson | nominally 500 RUB / acad h |
| Extra B 90 legacy | lesson/event | 1,500 RUB / lesson | nominally 750 RUB / acad h |
| Internal city exam | event/output | 200 RUB / event | not hour-based |
| Tsl | lesson/event | 574.50 RUB / lesson | nominally 191.50 RUB / acad h |
| Moto | lesson/event | 450 RUB / lesson | nominally 225 RUB / acad h |
| Extra moto | lesson/event | 650 RUB / lesson | nominally 325 RUB / acad h |
| Trainer | lesson/event | 150 RUB / lesson | nominally 50 RUB / acad h |

For lesson-based types, payroll is calculated by event/lesson count. Academic hours are a control signal and must not silently change payroll when an ASHK event has a non-standard duration.

## Architectural options considered

### Option A — Keep category-B gross as payroll base
Rejected. It creates false negative net balances for masters who receive non-B compensation, e.g. moto/trainer work.

### Option B — Reconstruct payroll only from DDS cash movements
Rejected. DDS proves money movement but does not prove earned gross and cannot safely distinguish work components from advances, statutory deductions, reimbursements, and unrelated vehicle costs.

### Option C — Full verified gross from ASHK + evidence-based deductions
Selected. ASHK supplies earned work by type; DDS/bank/cash supplies confirmed prior payments and deductions; unresolved fuel/leasing remains blocked until person/vehicle allocation is authoritative.

## Data model

### 1. Verified gross layer

Per master, aggregate these components independently:
- B main driving
- Extra B 120
- Extra B 90 legacy
- Internal city exam events
- Tsl
- Moto
- Extra moto
- Trainer

Each component stores employee/master identifier, normalized name, work type, event count, academic hours, rate unit, rate, gross amount, and verification status. The final gross is the sum of all confirmed components.

### 2. Confirmed payment/deduction evidence layer

Only individually attributable August records may reduce outstanding net:
- salary advances
- official salary payments
- statutory/executive deductions
- individually confirmed other payroll deductions

Each record preserves source row/id, date, counterparty/description, normalized master, type, amount, and confidence/status. Ambiguous company-wide records are not allocated automatically.

### 3. Blocked allocation layer

These remain separate until an authoritative master/vehicle relation exists:
- fuel
- leasing
- vehicle rent/other car costs
- pooled master payroll transfers without individual breakdown

A blocked amount may be shown in management diagnostics but must not reduce an individual master's final net.

### 4. Gross-to-net calculation

For each master:

`verified_gross - confirmed_advances - confirmed_official_payments - confirmed_statutory_deductions - confirmed_other_individual_deductions = reconciled_outstanding_net`

This is not considered final while blocked individual allocations exist that business rules require to be withheld from masters.

## Safety gates

The payroll result can be promoted downstream only when all gates are green:

1. August ASHK archive verification = OK.
2. All payroll work types used in August have a confirmed rate/unit.
3. Sum of per-master verified gross equals aggregate verified gross.
4. Internal exams are paid by event count, not hours.
5. Moto, extra moto, trainer, Tsl and extra-driving lesson types are paid by event count; hours are control only.
6. Confirmed advances/official payments/statutory deductions reconcile to source rows.
7. No negative net is accepted without an explicit business explanation.
8. Fuel/leasing deductions are either authoritatively allocated or explicitly excluded from final payroll.
9. Existing payouts already made are reconciled before updating reserve requirements.
10. `Фонд вождения` is not updated before gates 1–9 pass.

## Error handling

- Unknown ASHK session type -> status BLOCKED; exclude from final payroll promotion.
- Non-standard hours for a lesson-based event -> keep event-count payroll, flag hours anomaly.
- Multiple names/aliases for one master -> normalize by employee id where possible; otherwise alias map with review flag.
- DDS payment mentions a master in description but beneficiary differs -> preserve both and require explicit attribution logic.
- Generic pooled payment to an intermediary/contractor -> do not allocate per master without supporting registry.
- Negative outstanding net -> status REVIEW_REQUIRED, never interpreted automatically as a debt owed back by the master.

## Testing / verification strategy

Before any downstream switch:
- fixture tests for every work type and unit
- explicit test that 188 internal-exam events with 189 hours pay 188 x 200, not 189 x 200
- explicit regression that 521 Extra B 120 events with 1,561 hours pay 521 x 1,500, not 1,561 x 500
- explicit tests that moto event = 450 RUB, extra moto event = 650 RUB, trainer event = 150 RUB
- aggregation test: per-master component sum equals total gross
- deduction test: only confirmed individual evidence reduces net
- blocker test: unallocated fuel/leasing cannot reduce individual net
- negative-net test: status becomes REVIEW_REQUIRED
- regression test against current August archive controls

## Implemented August control result

The live staging block `VERIFIED FULL GROSS / NET — АВГУСТ 2026` in `АШК_Расчет_мастеров__staging` currently reconciles to:

- Main B: 1,631,580 RUB
- Extra B 120: 781,500 RUB
- Extra B 90: 10,500 RUB
- Internal exams: 37,600 RUB
- Tsl: 14,362.50 RUB
- **Corrected B gross: 2,475,542.50 RUB**
- Moto: 121,950 RUB
- Extra moto: 35,750 RUB
- Trainer: 37,500 RUB
- **Full verified gross: 2,670,742.50 RUB**
- Confirmed advances: 77,090.43 RUB
- Confirmed official payments: 64,961.17 RUB
- Confirmed statutory deductions: 33,870.40 RUB
- **Confirmed evidence total: 175,922 RUB**
- **Intermediate outstanding net: 2,494,820.50 RUB**

The intermediate outstanding net is explicitly **not** the final payout amount.

Resolved diagnostic: Tolstoukhov's previous B-only gross was zero because his August work is moto. Full verified gross is 157,700 RUB; after 27,514 RUB confirmed August payments his intermediate outstanding net is 130,186 RUB.

Still blocked: Atalykov has verified gross 15,041 RUB and confirmed August settlement/deductions 29,340 RUB, leaving -14,299 RUB. This is `REVIEW_REQUIRED`, not an automatic debt. It requires an explanation or an additional payroll component/source before final promotion.

Other blockers: fuel/leasing remain unallocated to individual masters, and pooled/existing master payouts without a personal registry are not yet fully reconciled.

## Intended sheet/output changes

The old interim blocks in `АШК_Расчет_мастеров__staging` remain for audit history. The implemented verified section contains full per-master gross by component, confirmed payment/deduction columns, unresolved allocation columns, outstanding net, status, aggregate reconciliation, and gate summary.

The existing `Фонд вождения` sheet remains unchanged by this implementation.

## Downstream sequence after payroll verification

1. Explain/reconcile the Atalykov negative net and any other review-required rows.
2. Resolve or explicitly exclude fuel/leasing allocations.
3. Reconcile pooled/existing August master payouts with individual recipients.
4. Re-run gates and calculate final outstanding payroll.
5. Compare approved requirement with current driving-fund balance.
6. Only with owner approval, update `Фонд вождения` reserve/control.
7. Propagate approved payroll obligation into DDS/P&L/Owner Dashboard/cash forecast.

## Non-goals

- No change to Tochka ingestion.
- No change to ASHK raw-hours ingestion.
- No automatic money movement.
- No automatic fuel/leasing allocation without an authoritative mapping.
- No production Decision Engine write behavior change in this scope.
