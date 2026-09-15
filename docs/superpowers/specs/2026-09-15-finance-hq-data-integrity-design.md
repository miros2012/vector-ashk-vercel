# Finance HQ Data Integrity Design

## Goal
Make the owner morning finance HQ use fresh, correctly interpreted data and degrade safely when one upstream source fails.

## Scope
This change fixes five concrete production problems observed on 2026-09-15:
1. Cash freshness is incorrectly based on the date of the last journal transaction instead of the latest verification/photo review.
2. Finance orchestration is fail-fast, so one failed ASHK stage prevents later independent stages from refreshing.
3. Intraday ROP refreshes payments but not receivables, so receivables can stay stale for a full day after a failed nightly run.
4. Driving-fund control uses a legacy reserve model instead of actual completed driving work extrapolated to month end; the active allocation rate is 40%.
5. Royalty control reports current balance/required amount but not whether the fund will reach the required month-end payment at the active 17% allocation rate.
6. Obvious Tochka operations (student refunds, admin payroll advances, enforcement deductions) are left as manual classification even when the payment purpose is deterministic.

## Architecture
Keep existing Google Sheets as the canonical operational store and Vercel as the sync/runtime layer. Fix each metric at its source rather than patching presentation text.

### Cash freshness
`Data Health Snapshot` must evaluate branch cash freshness using the latest verification evidence available from `Контроль кассы`: prefer `Дата фактического пересчёта`; when a new photo was reviewed but explicitly documented as not a new physical recount, use the review/photo date as `lastVerifiedAt` while preserving the journal balance date separately. A recent verification must not be reported as stale merely because no cash transaction occurred afterward.

### Independent source refresh
Nightly finance stages `hours`, `payments`, and `receivables` are independent data-source refreshes. The orchestrator must attempt all three even when one fails, record per-stage status, and only block dependent downstream stages when their prerequisite is unavailable. In particular:
- hours failure must not prevent payments or receivables from running;
- payments failure must not prevent receivables from running;
- downstream ROP publication requires fresh/verified payments and receivables;
- Tochka→DDS, balances and data-health should still run when their own prerequisites are healthy.

Intraday orchestration must refresh receivables before rebuilding ROP, not only payments.

### Driving fund forecast
Driving control must use current-month ASHK completed work, not accumulated student service liabilities or prior-month average reserve.
For each supported driving type, convert completed ASHK rows/units to master accrual using the verified rate model. Compute:
- `accruedToDate`;
- `closedDays` = latest completed business date present in the current-month ASHK hours feed;
- `forecastMonthAccrual = accruedToDate / closedDays * daysInMonth`;
- `currentFundBalance` from live Tochka;
- `remainingNeed = max(forecastMonthAccrual - currentFundBalance, 0)`;
- `requiredFutureReceipts = remainingNeed / 0.40`;
- `projectedMonthEndFund = currentFundBalance + max(monthRevenueForecast - revenueToDate, 0) * 0.40`;
- `projectedBuffer = projectedMonthEndFund - forecastMonthAccrual`.
Temporary non-driving payments reimbursed back to the Driving fund are neutral to the fund forecast and must not be double-counted as structural consumption.

### Royalty forecast
Use the current live Royalty balance, active 17% allocation rate, revenue-to-date and month revenue forecast. Determine the expected royalty rate from the final forecast thresholds (<6m=16%, 6–9m=14%, >9m=12%), then compute:
- `requiredRoyalty = forecastRevenue * expectedRoyaltyRate`;
- `projectedAdditionalRoyalty = max(forecastRevenue - revenueToDate, 0) * 0.17`;
- `projectedMonthEndRoyalty = currentRoyaltyBalance + projectedAdditionalRoyalty`;
- `projectedRoyaltyBuffer = projectedMonthEndRoyalty - requiredRoyalty`.
Expose threshold risk when the forecast is close to 6m or 9m.

### Tochka→DDS classification
Add conservative deterministic rules only for descriptions that are unambiguous:
- outgoing payment with purpose containing `Возврат оплаты` or `Возврат ... по заявлению` to a student/person → `Возвраты курсантам`;
- outgoing payment with purpose containing `Аванс за сентябрь`/`Аванс за <month>` to known admin employees → `Зарплата админ персонала`;
- outgoing payment to UFK/FSSP with purpose containing `Исполнительному производству`, `удержанные задолженности`, `алименты` → employee payroll withholding category, mapped consistently to payroll rather than manual review.
Do not add a generic rule for ambiguous IP Egorov / contractor transfers. The 37,500 RUB cadet-kit payment remains a user-confirmed business classification and its Driving-fund transfer/reimbursement must be treated as economically neutral in the owner forecast.

## Error handling and diagnostics
Every source stage must return an explicit stage name, HTTP status and safe error class/message suitable for runtime diagnostics. A single failure must not collapse the whole source-refresh sequence into an opaque HTTP 500 with only `Error` in logs.

## Testing
Add regression tests for:
- verified cash photo/review date overriding stale journal activity for freshness;
- nightly orchestrator continues independent stages after hours/payments failure;
- intraday orchestrator calls receivables before ROP publication;
- driving forecast uses actual current-month accrual, 40% allocation and month extrapolation;
- royalty forecast uses 17% allocation and threshold rate;
- deterministic refund/admin-advance/FSSP classifications;
- no auto-classification of ambiguous contractor operations.

Run the full repository test suite before merge. Production verification requires fresh markers for hours/payments/receivables, a current-day ROP row, cash freshness reflecting 14.09 verification evidence, and a reduced Tochka→DDS manual backlog without touching ambiguous transactions.
