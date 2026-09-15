# ROP personal refund KPI fix

## Root cause

`РОП_Контроль_Дня` uses the same signed payment stream for branch cash fact and manager personal KPI. A September refund of 48,267 RUB for an August sale was therefore subtracted from Антонова Карина's September personal KPI, producing 1,383 RUB instead of 49,650 RUB.

## Intended behavior

- Branch/city cash fact remains net of payments and refunds.
- Manager personal KPI counts positive attributed payments only; refunds do not reduce the current-month personal sales KPI.
- Sale-employee attribution itself remains unchanged.
- Add a regression test reproducing Karina's 49,650 positive payments and 48,267 refund.

## Verification

Run the full Node test suite before merge and verify production ROP after the next rebuild/manual refresh.
