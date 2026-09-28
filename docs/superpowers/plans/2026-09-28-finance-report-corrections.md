# Corrections to the Vector finance report

## Goal

Correct the owner report and its refresh contour so that it shows Miroslav's accountable cash, uses the agreed driving-fund and royalty rules, and does not stop polling Tochka at 20:00 Yekaterinburg time.

## Work

1. Extend the intraday refresh window and cover the schedule with a regression test.
2. Add wallet 201 (Miroslav, accountable cash) to the read-only owner package and the Money section, with fail-closed source validation and tests.
3. Update the live spreadsheet formulas for the driving fund: master accrual less already-paid Fuel, Vehicles, and Driving-range rent expenses.
4. Update the royalty bands in the settings and every dependent report formula to 15% below 6m, 13% from 6m through 9m, and 11% above 9m.
5. Verify the full test suite, spreadsheet formulas and resulting values, then ship and verify production.

## Verification

- Focused tests fail before the code changes and pass after them.
- Full `npm test` passes.
- Spreadsheet readback confirms formulas, calculated amounts, and updated timestamps.
- Production deployment is READY and the owner package exposes the new metric.
