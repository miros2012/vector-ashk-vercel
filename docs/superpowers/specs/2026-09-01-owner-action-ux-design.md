# Owner Action UX + Decision Effectiveness — Design

## Context
The Decision Engine is now cut over to backend ownership for rule-derived state in `Решения` (H/J/M/P). Production cutover was verified 4/4 with drift 0, audit commit verified TRUE, and Execution Layer remains separate.

The next product step is to let the owner act on recommendations from the Owner Dashboard without working directly in the `Решения` table, while preserving backend APIs as the long-term interface for a future web dashboard.

## Chosen approach
Use **Option C**:

1. First working UX lives in the existing Google Sheets `Панель собственника` as the reference-client interface.
2. All state-changing actions go through backend APIs, not direct business-state edits from dashboard formulas.
3. The backend contract is designed to be reusable unchanged by a later standalone web Owner Dashboard.

This keeps the reference implementation fast while preventing Google Sheets from becoming the product architecture.

## Product flow
The user-facing lifecycle is:

`AI recommendation → take into work → complete → verify result → record actual financial effect`

The existing backend lifecycle remains authoritative:
- `start`: `Не начато → В работе`
- `complete`: `В работе → Готово`
- `verify`: only from `Готово`; records verification status and actual financial effect.

Verification states remain:
- `Подтверждено`
- `Нет эффекта`
- `Не применимо`

For `Подтверждено`, actual financial effect is required.

## Owner Dashboard UX v1
The dashboard should surface one focused **Owner Action** block for the highest-ranked active decision, not expose the full raw rule table.

The block shows:
- Decision / recommended action
- Why it matters
- Deadline
- Priority
- Planned financial risk/effect
- Current execution status
- Current verification status
- Actual verified effect, when available
- Last execution result / evidence summary when available

Available actions are context-sensitive:
- `Не начато` → `В работу`
- `В работе` → `Готово`
- `Готово` and not verified → `Подтвердить эффект`, `Нет эффекта`, `Не применимо`

The dashboard itself does not directly mutate K/N/R:V in `Решения`. Actions are represented as an **action request** that the backend executes through the existing decision execution contract.

## Backend/API architecture
Keep `/api/decision-event` as the state-changing primitive. Add a read-only owner-action view model endpoint, conceptually:

`GET /api/owner-action`

It returns only the normalized data needed by the dashboard and later web UI:
- ruleId
- title/event
- deviation/why
- recommendation
- task
- assignee/role
- deadline
- priority
- executionStatus
- verificationStatus
- plannedEffect
- actualEffect
- linkedObject
- allowedActions
- lastResult
- lastChecked

The endpoint must not expose spreadsheet formulas or implementation-only rank fields.

For mutations, the client calls the existing `/api/decision-event` contract with:
- ruleId
- action (`start`, `complete`, `verify`)
- requestId for idempotency
- expectedExecutionStatus for optimistic concurrency
- result/evidence fields when completing
- verificationStatus and actualEffect when verifying

## Google Sheets interaction model
Because Google Sheets is only the reference UX, v1 should avoid fragile custom Apps Script button logic.

Use a small **Owner Action Control** range on `Панель собственника` with:
- selected/top decision data populated from backend-owned state already mirrored in Sheets;
- a dropdown for requested action;
- optional input fields for completion result / evidence and verified financial effect;
- a request/status area that clearly distinguishes `READY`, `SENT`, `SUCCESS`, `ERROR`.

The write request path should be through the backend API. If direct interactive Sheets-to-API invocation is not reliable without Apps Script, the control range remains the visible UX while a minimal authenticated trigger mechanism is introduced separately. The backend contract must remain independent from that transport.

## Decision Effectiveness metrics
The product must begin measuring realized value from the same immutable execution history.

Core metrics:
- planned risk/effect
- actual verified effect
- recommendation count
- started count / start rate
- completed count / completion rate
- verified count / verification rate
- confirmed-effect count
- total confirmed financial effect
- time-to-start
- time-to-complete
- time-to-verification
- effect realization ratio where planned and actual values are comparable

Metrics are derived from `Решения` + append-only `История решений`; no destructive aggregation writes into history.

## Source of truth boundaries
- Backend Rule Engine owns rule-derived financial state H/J/M/P.
- Execution Layer owns human execution state K/N/R:V and immutable `История решений`.
- `Панель собственника` is a presentation/control surface, not a source of truth.
- A future web dashboard consumes the same owner-action read model and decision-event write API.

## Safety and concurrency
Required protections:
- requestId idempotency for every mutation;
- expectedExecutionStatus optimistic concurrency;
- inactive rules cannot be executed;
- verification cannot occur before completion;
- confirmed effect requires numeric actualEffect;
- dashboard must never overwrite rule-derived H/J/M/P;
- dashboard must never write immutable history directly;
- all successful execution mutations append history atomically with state updates.

## MVP success criteria
The stage is complete when, for the top active recommendation:
1. The owner can see the recommendation and its financial importance on `Панель собственника`.
2. The owner can move it through `Не начато → В работе → Готово → verified` without editing the raw `Решения` row.
3. Every mutation is executed through backend API semantics with idempotency and concurrency protection.
4. `История решений` contains the immutable lifecycle events.
5. A confirmed verification records actual financial effect.
6. Dashboard shows cumulative confirmed financial effect and basic execution funnel metrics.
7. The same API contract is sufficient for a later standalone web UI.

## Explicitly out of scope for this stage
- Full standalone web dashboard UI.
- Multi-tenant SaaS/auth model.
- Replacing Google Sheets as MVP storage.
- ML-based recommendation learning.
- Automated assignment/escalation workflows beyond current role/deadline fields.
- Additional industry-specific rules.
