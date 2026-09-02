# Verified master payroll gross-to-net — final inline review

Date: 2026-09-02
Branch: `feat/master-payroll-verified-gross-net`
Review mode: structured inline review because subagent dispatch is unavailable in this ChatGPT surface.

## Scope compliance

- No new `api/*.js` route added.
- No `vercel.json` changes.
- No Decision Engine behavior changes.
- Payroll writes in Google Sheets targeted only `АШК_Расчет_мастеров__staging` (sheetId 452930113).
- `Фонд вождения` was read for verification only and remains on the historical/manual August values.

## Functional checks

- Main B driving uses academic hours × 383 RUB.
- Extra B120/B90, internal exam, Tsl, moto, extra moto and trainer use event count.
- August archive controls: 2,734 events / 7,501 hours / verification OK.
- Correct event-based B gross: 2,475,542.50 RUB.
- Full verified gross: 2,670,742.50 RUB.
- Confirmed individual evidence: 175,922 RUB.
- Intermediate outstanding net: 2,494,820.50 RUB.
- Atalykov remains REVIEW_REQUIRED at -14,299 RUB; not interpreted as debt.
- Tolstoukhov full gross includes moto/extra moto and resolves the prior false B-only negative.
- Fuel/leasing remain blocked without authoritative master allocation.
- Confirmed evidence whose masterKey is absent from verified gross now blocks `EVIDENCE_RECONCILED` instead of being silently dropped.

## Gate state from live staging

- ASHK_ARCHIVE_OK: true
- ALL_SESSION_TYPES_RATED: true
- PER_MASTER_EQUALS_AGGREGATE: true
- EVENT_BASED_RULES_OK: true
- EVIDENCE_RECONCILED: true
- NO_UNEXPLAINED_NEGATIVE_NET: false
- VEHICLE_ALLOCATIONS_RESOLVED_OR_EXCLUDED: false
- EXISTING_PAYOUTS_RECONCILED: false
- PROMOTION_STATUS: BLOCKED

## Test evidence

GitHub Actions run `33594324436` completed successfully after the EmployeeId integration regression and unmatched-evidence guard were present on the branch.

## Review outcome

No load-bearing code issue remains in the implemented staging/calculation scope. Downstream promotion is intentionally blocked by unresolved business evidence, not by a calculator/test failure. Do not update `Фонд вождения` or treat 2,494,820.50 RUB as the final payout until the three red business gates are resolved.
