# Verified master payroll gross-to-net design

Date: 2026-09-02
Status: design approved in chat; implementation pending written-spec review
Scope: August 2026 master payroll verification and downstream driving-fund control

## Goal

Replace the unsafe category-B-only payroll control with a full verified master payroll chain:

ASHK work events -> verified gross by work type -> confirmed prior payments/deductions -> unresolved allocations -> final net -> driving fund reserve/update.

No production payout, `Фонд вождения`, DDS, P&L, or owner dashboard value may be switched to the new payroll result until the final reconciliation gates pass.

## Current verified source

Official work-event source: `GET /api/MasterWorkReportDetails`, BuildMode=1 / byTrainingHourType.

August archive control:
- 2,734 rows
- 7,501 academic hours
- verification = OK
- business timezone = Asia/Yekaterinburg

Current category-B gross control is 2,474,542.50 RUB and remains useful as a component, not as total master gross.

## Confirmed rate model

Rates are confirmed by the owner on 2026-09-02.

| Work type | Pay unit | Confirmed rate | Equivalent hourly control |
|---|---:|---:|---:|
| Main driving 120/160 | academic hour | 383 RUB / acad h | 383 RUB / acad h |
| Extra B 120 | 3 acad h lesson | 1,500 RUB / lesson | 500 RUB / acad h |
| Extra B 90 legacy | 2 acad h lesson | 1,500 RUB / lesson | 750 RUB / acad h |
| Internal city exam | event/output | 200 RUB / event | not hour-based |
| Tsl | 3 acad h lesson | 574.50 RUB / lesson | 191.50 RUB / acad h |
| Moto | 2 acad h lesson | 450 RUB / lesson | 225 RUB / acad h |
| Extra moto | 2 acad h lesson | 650 RUB / lesson | 325 RUB / acad h |
| Trainer | 3 acad h lesson | 150 RUB / lesson | 50 RUB / acad h |

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

Each component stores:
- employee/master identifier
- normalized master name
- work type
- event count
- academic hours
- rate unit
- rate
- gross amount
- verification status

The final gross is the sum of all confirmed components.

### 2. Confirmed payment/deduction evidence layer

Only individually attributable August records may reduce outstanding net:
- salary advances
- official salary payments
- statutory/executive deductions
- individually confirmed other payroll deductions

Each record must preserve:
- DDS/source row or stable source id
- date
- source counterparty/description
- normalized master
- deduction/payment type
- amount
- confidence/status

Ambiguous company-wide records are not allocated automatically.

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
5. Moto, extra moto, and trainer are paid by lesson/event count; hours are only control.
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
- explicit tests that moto 2h event = 450 RUB, extra moto 2h event = 650 RUB, trainer 3h event = 150 RUB
- aggregation test: per-master component sum equals total gross
- deduction test: only confirmed individual evidence reduces net
- blocker test: unallocated fuel/leasing cannot reduce individual net
- negative-net test: status becomes REVIEW_REQUIRED
- regression test against current August archive totals

## Intended sheet/output changes

Current interim block in `АШК_Расчет_мастеров__staging` remains diagnostic.

Implementation should add/replace a clearly labeled verified section containing:
- full per-master gross by component
- confirmed deduction/payment columns
- unresolved allocation columns
- outstanding net
- status/gate column
- aggregate reconciliation row

The existing `Фонд вождения` sheet is unchanged until final reconciliation is approved.

## Downstream sequence after payroll verification

1. Finalize per-master full gross.
2. Reconcile confirmed payments/deductions.
3. Resolve or explicitly exclude fuel/leasing allocations.
4. Calculate final outstanding payroll.
5. Compare required amount with current driving-fund balance.
6. Update `Фонд вождения` reserve/control.
7. Propagate approved payroll obligation into DDS/P&L/Owner Dashboard/cash forecast.

## Non-goals

- No change to Tochka ingestion.
- No change to ASHK raw-hours ingestion.
- No automatic money movement.
- No automatic fuel/leasing allocation without an authoritative mapping.
- No production Decision Engine write behavior change in this scope.
