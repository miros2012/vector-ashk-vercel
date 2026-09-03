# Nightly Payroll Runtime Design

Date: 2026-09-03
Status: proposed; owner approved architecture in chat, written spec awaiting final review
Scope: automatic nightly recalculation of verified master payroll and downstream finance controls without adding a new Vercel route

## Goal

Turn the verified master-payroll calculation into an autonomous nightly pipeline so the owner does not need to manually rebuild August-style staging calculations. The system must recalculate payroll from the current ASHK work archive, use stable personal rate cards and confirmed evidence, preserve unresolved items as OPEN_REVIEW, and refresh downstream finance controls without guessing or double-counting.

## Current starting point

The existing verified payroll domain is already in `main` and includes:
- personal/date-aware rate support in `lib/master-payroll-gross.js`;
- evidence normalization in `lib/master-payroll-evidence.js`;
- reconciliation and `VERIFIED_WITH_OPEN_REVIEW` semantics in `lib/master-payroll-reconciliation.js`;
- staging rendering in `lib/master-payroll-sheet-adapter.js`;
- nightly ASHK hours ingestion through `api/sync-hours.js` and `api/nightly-finance-orchestrator.js`.

Current August verified controls remain the regression baseline:
- ASHK-backed gross: 2,328,122 RUB;
- effective payroll gross: 2,346,622 RUB;
- confirmed payments/deductions: 529,782.22 RUB;
- verified interim outstanding: 1,816,839.78 RUB;
- status: `VERIFIED_WITH_OPEN_REVIEW`.

These values are a regression reference, not hard-coded runtime outputs for future months.

## Selected architecture

Use three stable internal Google Sheets as the source/runtime boundary:

1. `Payroll Rate Cards` — personal rates by EmployeeId, work type, amount/unit and validity dates.
2. `Payroll Evidence` — only individually confirmed payroll settlements/deductions that may reduce outstanding net.
3. `Payroll Runtime` — the latest deterministic nightly calculation and gate status.

The backend reads the existing ASHK archive written by the hours sync, reads Rate Cards and Evidence, calculates gross/reconciliation with the existing payroll domain modules, writes Payroll Runtime, performs readback verification, then lets downstream sheets consume the verified runtime values.

No new API route or Serverless Function is added. The existing `api/nightly-finance-orchestrator.js` gains a payroll stage after successful hours sync and before downstream finance/decision processing.

## Data flow

Nightly sequence:

`ASHK MasterWorkReportDetails -> sync-hours -> verified ASHK archive -> Payroll Rate Cards + Payroll Evidence -> payroll runtime calculation -> Payroll Runtime -> Фонд вождения / Обязательства / Прогноз 30 дней / Панель собственника -> decisions`

The payroll stage must not fetch the one-off workbook `АВГУСТ 2026 г.`. That workbook was useful as a source for migrating initial rate cards/evidence, but it contains stale/manual template values and is not a safe runtime dependency.

## Payroll Rate Cards

Purpose: stable editable business configuration so a rate change does not require code deployment.

Required columns:
- `EmployeeId`
- `MasterName`
- `SessionTypeName`
- `Mode` (`hour` or `event`)
- `Rate`
- `ValidFrom`
- `ValidTo`
- `Group`
- `Status`
- `Source`
- `UpdatedAt`

Rules:
- EmployeeId is the primary key component; names are descriptive only.
- A rate card key is `(EmployeeId, SessionTypeName, ValidFrom, ValidTo)`.
- Date ranges for the same EmployeeId/session type must not overlap.
- `ValidTo` may be blank for an open-ended rate.
- Missing applicable rate for an active ASHK event is a hard blocker.
- Multiple applicable rates for one event are a hard blocker.
- Shared rates may be represented by a dedicated shared configuration only for truly global work types such as confirmed moto/trainer rules; personal B-driving rates must not silently fall back to the historical universal 383 model.
- Initial migration must preserve the verified August 28/28 coverage and the dated Zakharov rate change.

## Payroll Evidence

Purpose: stable journal of only confirmed individual payroll offsets.

Required columns:
- `EvidenceId`
- `Period`
- `EmployeeId`
- `MasterName`
- `Type`
- `Amount`
- `SettlementGroup`
- `SourceId`
- `SourceDate`
- `Status`
- `Confidence`
- `Comment`
- `UpdatedAt`

Allowed confirmed types remain:
- `ADVANCE`
- `OFFICIAL_PAYMENT`
- `STATUTORY_DEDUCTION`
- `OTHER_CONFIRMED_INDIVIDUAL`

Official salary settlement rules remain unchanged: official gross is settled once and bank split / tax / statutory payments must not double-reduce personal net.

Unresolved fuel, anonymous payouts, undated deductions, or other ambiguous records may be retained for audit with review status, but they must not reduce personal net until confirmed.

## Payroll Runtime

Purpose: deterministic nightly output consumed by finance sheets.

Runtime must contain a compact summary plus per-master detail.

Summary fields:
- `RunId`
- `Period`
- `CalculatedAt`
- `ASHKArchiveStatus`
- `ASHKRows`
- `ASHKHours`
- `RateCoverage`
- `ASHKBackedGross`
- `EffectivePayrollGross`
- `ConfirmedEvidence`
- `OutstandingNet`
- `PromotionStatus`
- `OpenReviewCount`
- `OpenReviewAmountKnown`
- `SourceLoadedAt`

Per-master fields include:
- EmployeeId / name
- ASHK-backed gross
- official floor adjustment if applicable
- effective gross
- confirmed evidence total
- outstanding net
- status
- blockers/open-review note

The write must be atomic at the sheet level: construct all values in memory, replace the runtime block, read it back, and verify row count, headers, totals and run id before reporting success.

## Gate model

Hard blockers remain blockers:
- ASHK archive invalid or unavailable;
- unknown/unrated active work type;
- missing or overlapping personal rate period;
- per-master aggregate does not equal total;
- event-vs-hour pricing rule violation;
- evidence integrity failure or unmatched confirmed EmployeeId;
- runtime write/readback mismatch.

Soft business-review items do not block runtime refresh:
- fuel not personally allocated;
- small payout without confirmed EmployeeId;
- negative interim requiring review;
- undated/unconfirmed vehicle repair or fine.

If hard gates pass and soft items exist: `VERIFIED_WITH_OPEN_REVIEW`.
If hard gates fail: `BLOCKED` and downstream verified values must not be replaced by an unverified result.

## Failure handling and last-known-good behavior

The runtime pipeline must preserve the last known good verified result if the current nightly run is hard-blocked or fails before verified readback.

On failure:
- do not overwrite a last-known-good verified runtime with partial calculations;
- write failure diagnostics to a separate run/audit section or log;
- nightly orchestrator reports payroll stage `ok: false` for hard technical/data failures;
- soft OPEN_REVIEW does not make the stage fail.

Downstream financial formulas consume the latest verified runtime, not an incomplete run.

## Downstream integration

`Фонд вождения` keeps two different economic concepts separate:
- reserve for future driving hours at the configured reserve-cost rule;
- verified outstanding payroll already earned by masters.

The fund sheet must not add unconfirmed OPEN_REVIEW deductions to personal net.

`Обязательства` must use:
- gross obligation from Payroll Runtime;
- confirmed evidence as explicit net reductions;
- net cash outflow equal to verified outstanding.

`Прогноз 30 дней` consumes the net obligation once through `Обязательства`; it must not separately subtract estimated fuel/leasing again.

`Панель собственника` surfaces:
- verified payroll outstanding;
- payroll status;
- live driving-fund balance;
- future-hours reserve;
- combined requirement / control deficit;
- 30-day cash gap;
- open-review note.

## Nightly orchestration

Extend the existing orchestrator rather than add a route.

Desired sequence:
1. hours
2. payroll
3. payments (existing behavior may remain before/after payroll only if payroll evidence is sheet-backed and deterministic for the period)
4. receivables
5. decisions

Preferred final order for consistency is:
1. hours
2. payments
3. payroll
4. receivables
5. decisions

Reason: payroll should see the freshest payment/evidence inputs when they are sourced from the nightly payment staging. If Payroll Evidence remains curated and independent from payment sync, hours -> payroll is still valid; implementation tests will lock the selected dependency order.

A payroll failure must skip downstream decisions that would depend on refreshed payroll values. Receivables may remain independent, but the orchestrator response must make stage status explicit.

## Vercel / cost constraints

- Add no new file under `api/` solely for payroll.
- Add no new cron schedule.
- Reuse the existing nightly route.
- Prefer one Sheets client/auth session per invocation where practical.
- Batch Rate Cards/Evidence/Runtime reads and writes where it reduces requests without sacrificing readback verification.
- Do not increase ASHK calls beyond the existing hours sync for payroll; payroll reads the persisted verified archive.

## Initial migration

Create the two configuration sheets and migrate the currently verified August business configuration:
- 28 active EmployeeIds and their personal rate cards;
- dated Zakharov rate segments;
- confirmed shared moto / extra-moto / trainer rules where applicable;
- confirmed August evidence currently used by the verified regression;
- existing OPEN_REVIEW records retained separately and not applied to net.

Migration must be verified by reproducing the current August regression totals exactly to the kopek where applicable.

## Testing strategy

TDD coverage must include:
- rate-card parsing and date-range validation;
- exact August 28/28 rate coverage;
- Zakharov date split;
- missing/overlapping rate hard-blocking;
- runtime gross equals current August 2,328,122 RUB baseline;
- effective gross 2,346,622 RUB baseline;
- confirmed evidence 529,782.22 RUB baseline;
- outstanding 1,816,839.78 RUB baseline;
- OPEN_REVIEW returns `VERIFIED_WITH_OPEN_REVIEW` and does not change personal net;
- hard blocker preserves last-known-good runtime;
- runtime write/readback mismatch fails the stage;
- orchestrator stage order and skip behavior;
- no additional API route or cron required.

## Non-goals

- No automatic money transfer or payout.
- No automatic guessing of fuel allocation.
- No migration of every historical month in this phase.
- No replacement of ASHK hours ingestion.
- No rewrite of DDS/P&L.
- No new Vercel function.
- No requirement to close every OPEN_REVIEW item before the system can operate.

## Success criteria

The feature is complete when a nightly run can, without manual payroll calculation:
1. use the verified ASHK archive;
2. resolve every applicable personal rate or hard-block safely;
3. apply only confirmed evidence;
4. write/readback a verified Payroll Runtime;
5. reproduce the August regression baseline;
6. refresh downstream payroll/fund/obligation/forecast/dashboard controls from runtime;
7. report `VERIFIED_WITH_OPEN_REVIEW` when only soft unresolved items remain;
8. preserve the last known good result on hard failure;
9. add zero new Vercel routes and zero new cron schedules.
