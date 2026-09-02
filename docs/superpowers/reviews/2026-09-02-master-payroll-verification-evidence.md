# Verification evidence — verified master payroll gross-to-net

Date: 2026-09-02
Branch head before PR: `3c3eaec418e16615db5057d06354d1a8500607eb`

Fresh verification immediately before PR:

- GitHub Actions run `33594397555`: `Run full test suite` completed `success`.
- Live August ASHK verification: 2,734 rows / 7,501 academic hours / `verification=OK` / LoadedAt `2026-09-02T04:13:09.739Z`.
- Live staging total: full verified gross `2,670,742.50 RUB`; confirmed individual evidence `175,922 RUB`; intermediate outstanding net `2,494,820.50 RUB`.
- Live staging `PROMOTION_STATUS=BLOCKED`.
- Red gates: `NO_UNEXPLAINED_NEGATIVE_NET=false`, `VEHICLE_ALLOCATIONS_RESOLVED_OR_EXCLUDED=false`, `EXISTING_PAYOUTS_RECONCILED=false`.
- Live `Фонд вождения` historical/manual August rows still show: main hours 3,597; extra 1,294; master accrual total 2,024,651 RUB. They were not replaced by this implementation.
- Branch diff contains payroll libs/tests/fixture/docs/README only; no new API route and no `vercel.json` change.

Conclusion: calculator/staging implementation is verified, while downstream promotion correctly remains blocked by unresolved business evidence. `Фонд вождения` must remain unchanged until those business gates are resolved and approved.
