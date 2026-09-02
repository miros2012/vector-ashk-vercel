# Verified master payroll gross-to-net design

Date: 2026-09-02
Status: implemented; integration allowed as `VERIFIED_WITH_OPEN_REVIEW`
Scope: August 2026 master payroll verification and driving-fund control

## Goal

Build a reproducible master payroll chain:

ASHK work events -> personal rate cards -> verified gross -> confirmed prior payments/deductions -> open review -> verified outstanding -> Fund driving.

Unconfirmed amounts must never be guessed or allocated to a master automatically.

## Verified August controls

- ASHK archive: 2,734 events / 7,501 academic hours / verification OK.
- 28/28 active EmployeeIds have personal rate cards.
- ASHK-backed personal-rate gross: **2,328,122 RUB**.
- Effective payroll gross after confirmed official-gross floor: **2,346,622 RUB**.
- Confirmed payouts / offsets / individual deductions: **529,782.22 RUB**.
- Verified interim outstanding: **1,816,839.78 RUB**.

The old universal-rate controls are historical/rejected for actual payroll.

## Rate model

Personal rate cards override universal planning rates. Event-paid work is calculated by event count; hours are a control signal. Dated rate changes inside a month are supported. Missing personal rate for an active employee is a hard blocker.

## Official salary layer

Confirmed official gross of 32,200 RUB is applied once only to approved employees. Bank advance / salary / tax / statutory split inside that official layer must not be deducted twice. Separate piecework advances remain separate evidence.

## Evidence policy

Only individually evidenced deductions reduce a master's outstanding amount. Unallocated fuel, unidentified pooled payouts, undated debt, or unresolved period-specific items stay outside personal net until confirmed.

## Promotion policy

Gates are split into two classes.

### Hard core gates
A failure keeps status `BLOCKED`:
1. ASHK archive verification.
2. All active work types / rate cards resolved.
3. Sum of per-master gross equals aggregate gross.
4. Event-based rules valid.
5. Confirmed evidence is valid, unique, and linked to verified masters.

### Open-review gates
These remain visible and auditable but no longer block integration when all core gates are green:
1. Unexplained negative interim net.
2. Unallocated fuel / vehicle evidence.
3. Existing pooled payouts not fully attributed.
4. Other unresolved period-specific deductions.

Statuses:
- `BLOCKED` — at least one hard core gate failed.
- `VERIFIED_WITH_OPEN_REVIEW` — core is green, but review items remain.
- `READY` — core and review gates are all green.

Masters with negative interim remain `REVIEW_REQUIRED`; this is never interpreted automatically as debt.

## Current open review

- Fuel allocation.
- 3,320 RUB unallocated payroll payouts (3,000 RUB from 19.08 + 320 RUB cash at Melnikaite).
- Kozlov negative interim review; not a debt.
- Undated Kozlov 562.50 RUB deduction.
- Augustenyak 10,996 RUB repair period review.

These amounts are excluded from personal net until confirmed and do not block further system integration.

## Fund driving rule

`Фонд вождения` may consume only the verified confirmed layer. Open-review amounts remain outside personal deductions and stay visible in diagnostics. No automatic money movement is introduced.

## Safety invariants

- Unknown ASHK type or missing rate -> hard `BLOCKED`.
- Unallocated fuel/leasing -> never allocated proportionally or by guess.
- Negative net -> `REVIEW_REQUIRED`, never automatic debt.
- Confirmed evidence for a missing master -> hard `BLOCKED`.
- Money comparisons are verified to kopeck precision.

## Downstream sequence

1. Merge verified payroll engine into main.
2. Keep open-review register active.
3. Connect Fund driving to the verified confirmed layer only.
4. Propagate the approved payroll obligation into DDS / P&L / owner dashboard / cash forecast.
5. Close review items later as better evidence appears, without blocking the system.

## Non-goals

- No change to Tochka ingestion.
- No change to raw ASHK-hours ingestion.
- No automatic money movement.
- No guessed fuel/leasing allocation.
