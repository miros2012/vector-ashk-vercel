# ASHK sale-employee attribution design

## Goal

Replace the incorrect manager attribution in the ROP dashboard with the employee who conducted the sale in ASHK. Preserve the separate branch plan/fact metric and keep the current live sheets unchanged until staging verification passes.

## Confirmed source behavior

- The current ASHK account has access to Finance → Sales.
- The Sales page loads the internal `SaleList` command from `/api/SaleList`.
- The sale model contains `Id`, `EmployeeName`, `StudentOwnerName`, `StudentId`, `Date`, `Sum`, and `Paid`.
- `EmployeeName` is the value displayed as “Сотрудник, проводивший продажу”.
- The existing public `SaleExternalList` does not expose that employee.
- The current implementation attributes payments through `CashboxOperationList` by timestamp and amount. This is not the seller and is incomplete for automatic payments.

## Metric definitions

| Metric | Source and attribution |
|---|---|
| Personal sales fact | Sum of qualifying sales grouped by `Sale.EmployeeName` and sale date |
| Personal payment fact | Payment records grouped by payment date, joined by `Payment.SaleId → Sale.Id`, then attributed to `Sale.EmployeeName` |
| Personal plan completion | Personal payment fact divided by the manager’s personal payment plan |
| Branch plan completion | Existing branch fact divided by the branch plan; retained as a separate metric |
| Unattributed payments | Payments with no `SaleId`, no resolvable sale, or no seller; never assigned through owner/cashier fallback |

`StudentOwnerName`, contract owner, and cashbox operation employee must not be used as fallbacks for personal sales or payment facts.

## Architecture

### 1. ASHK web-session client

Add a focused library used by the existing payment synchronization route. It will:

1. GET the ASHK login page and read the anti-forgery token and initial cookies.
2. POST `Login` with `ASHK_WEB_LOGIN` and `ASHK_WEB_PASSWORD` from Vercel environment secrets.
3. Retain session cookies in memory only for the current invocation.
4. Call `/api/SaleList` for the requested sales period.
5. If a payment references a sale outside that period, call `/api/SaleGet` for the missing `SaleId` and cache the result for the invocation.
6. On one `401/403`, re-authenticate once and retry. Further failure stops the staging sync.

If ASHK requires two-factor authentication, CAPTCHA, or returns a changed response contract, the connector fails closed and reports a non-secret diagnostic. It must not attempt to bypass those controls.

### 2. Data join

The public payment API remains the source of payment amount and payment date. Seller attribution is added as follows:

```text
PaymentRecordExternalDebitList
  → payment.SaleId
  → SaleList / SaleGet sale.Id
  → sale.EmployeeName
  → SaleEmployeeName on payment staging row
```

The join is deterministic by numeric/string-normalized `SaleId`. No timestamp-and-amount matching is used for the new personal metric.

### 3. Staging and promotion

- Add a sales staging sheet named `АШК_Продажи__vercel`.
- Add `SaleEmployeeName` and attribution status to payment staging data.
- Keep `PaymentEmployeeName` temporarily for comparison only; it must not feed the new personal fact.
- Publish diagnostics: total payments, attributed payments, missing `SaleId`, missing sale, empty seller, authentication state, source freshness, and totals reconciliation.
- Do not overwrite current live ROP sheets when login, schema, totals, or staging readback verification fails.

Promotion to the live ROP calculation requires:

1. Payment row count and payment amount remain equal to the public payment source.
2. Every resolved seller equals the ASHK sale employee for the same `SaleId`.
3. All unresolved rows are visible in diagnostics and are not silently reassigned.
4. Shumilova Polina for 2 September and at least three other managers are manually cross-checked against the ASHK Sales journal.
5. Existing branch plan/fact columns remain present and unchanged in meaning.

## Security

- Store `ASHK_WEB_LOGIN` and `ASHK_WEB_PASSWORD` only as encrypted Vercel environment variables.
- Never write credentials, cookies, anti-forgery tokens, or full login responses to logs, sheets, Git, or API responses.
- Use the current employee account initially, as approved. A dedicated read-only account can replace it later without code changes.
- Do not persist session cookies between invocations.

## Deployment constraints

Vercel Hobby function count is already at its practical limit. Reuse the existing `api/sync-payments.js` route and add library modules/tests; do not add another `api/*.js` function.

The hourly Tyumen schedule remains unchanged. Each scheduled run refreshes payments, sales attribution, staging diagnostics, and then the ROP calculation only after validation.

## Testing

- Unit tests for cookie parsing, anti-forgery extraction, login success/failure, one-time re-authentication, `SaleId` normalization, seller attribution, and unresolved diagnostics.
- Handler tests with mocked ASHK login, `SaleList`, `SaleGet`, and public payment responses.
- Regression test proving that contract owner and cashbox employee cannot override `Sale.EmployeeName`.
- Staging-only live probe before any live-sheet promotion.
- Full existing test suite and post-deployment health/staging verification before completion is claimed.

## Rollback

Until promotion, the live dashboard is untouched. After promotion, rollback is a single configuration/code switch back to the previous live calculation while preserving the new staging evidence. The old cashier attribution remains comparison-only and must not be presented as the correct personal fact.
