# Production P0 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the code-level P0 audit findings for payment staging, balance refresh authentication, atomic snapshot publication, and cash-transfer report classification without changing production configuration.

**Architecture:** Reuse the current cron bearer and bridge-key contracts, centralizing only their constant-time parsing/comparison. Replace destructive staging clears with one Google Sheets values batch containing both complete padded snapshots. Recognize Vercel-generated cash transfers from their stable operation marker while retaining the strict legacy text fallback.

**Tech Stack:** Node.js 24 ESM, `node:test`, Google Sheets API v4, existing Vercel functions.

**Spec:** `docs/superpowers/specs/2026-09-26-production-p0-hardening-design.md`

## Global Constraints

- Do not add an API function, paid service, database, queue, secret, dependency, or deployment change.
- Keep `POST /api/sync-payments` and `/api/balances` route paths.
- Authenticate before Sheets, ASHK, Vercel OIDC, bank, or state access.
- Use constant-time equality and generic failure responses; never log credentials.
- Preserve report fail-closed behavior for unknown financial rows.
- Do not modify Google ACLs, Apps Script, Vercel configuration, or environment values.
- Follow red-green-refactor for every production behavior.

## Review Focus

- Empty configured secrets must reject even an empty/malformed caller credential; Task 1 tests this in the shared helper and both handlers.
- Lower/upper-case header access and surrounding whitespace must not bypass or break bearer parsing; Task 1 tests canonical normalization behavior.
- A shorter payment or sales snapshot must erase every stale trailing cell without a pre-clear; Task 2 tests both different heights and fixed widths.
- A bridge source header without the bridge key, or a correct key without the source header, must reject before dependencies; Task 3 tests both halves independently.
- A forged cash marker with mismatched operation ID, part order, date, month, wallet, or cents must remain blocked; Task 4 tests each structural invariant.

---

### Task 1: Constant-time request authorization and payment-route guard

**Files:**
- Create: `lib/request-authorization.js`
- Create: `test/request-authorization.test.js`
- Create: `test/sync-payments-auth.test.js`
- Modify: `api/sync-payments.js:1-16,184-191`

**Interfaces:**
- Produces: `requestBearer(req) -> string`, extracting one trimmed `Bearer` token or `''`.
- Produces: `authorizeBearer(req, expectedSecret) -> boolean`, requiring a non-empty configured secret and constant-time equality.
- Produces: `authorizeHeader(req, headerName, expectedSecret) -> boolean`, requiring both non-empty values and constant-time equality.
- Payment handler consumes `authorizeBearer(req, process.env.CRON_SECRET)` before entering its `try` block.

- [ ] **Step 1: Write failing shared-helper tests**

Add cases for exact bearer success, missing/wrong/malformed bearer, empty expected secret, case-insensitive `Bearer`, trimmed token, exact custom-header success, and empty/wrong custom header.

- [ ] **Step 2: Run helper tests and verify RED**

Run: `node --test test/request-authorization.test.js`

Expected: FAIL because `lib/request-authorization.js` does not exist.

- [ ] **Step 3: Implement the minimal helper**

Use `timingSafeSecretEqual` from `lib/secret-compare.js`. Do not add logging or alternate credential channels.

- [ ] **Step 4: Run helper tests and verify GREEN**

Run: `node --test test/request-authorization.test.js`

Expected: all cases pass.

- [ ] **Step 5: Write failing payment-handler authorization tests**

Import the real handler. With Google credentials and ASHK key deliberately absent, assert `POST` with missing/wrong bearer returns 403 rather than reaching the existing missing-credential 500 path; assert non-POST remains 405. Restore all modified environment values after the test.

- [ ] **Step 6: Run payment auth tests and verify RED**

Run: `node --test test/sync-payments-auth.test.js`

Expected: unauthorized POST returns 500 before implementation, so the 403 assertion fails.

- [ ] **Step 7: Guard `api/sync-payments.js`**

Import `authorizeBearer`; after the method guard and before `try`, return `403 { ok: false, error: 'forbidden' }` unless `CRON_SECRET` matches.

- [ ] **Step 8: Verify focused and existing payment tests**

Run: `node --test test/request-authorization.test.js test/sync-payments-auth.test.js test/nightly-finance-orchestrator.test.js test/rop-intraday-orchestrator.test.js test/nightly-payments-stage.test.js`

Expected: all pass; existing orchestrators still propagate the cron bearer.

- [ ] **Step 9: Commit**

```bash
git add lib/request-authorization.js api/sync-payments.js test/request-authorization.test.js test/sync-payments-auth.test.js
git commit -m "fix: authenticate payment staging route"
```

### Task 2: Atomic dual staging publication

**Files:**
- Create: `lib/google-sheets-atomic-snapshots.js`
- Create: `test/google-sheets-atomic-snapshots.test.js`
- Modify: `api/sync-payments.js:220-265`
- Modify: `test/source-sync-marker-wiring.test.js` only if its structural assertion names the removed clear/update sequence

**Interfaces:**
- Produces: `replaceSheetSnapshotsAtomically({ sheets, spreadsheetId, snapshots }) -> Promise<{ ranges: string[] }>`.
- Each snapshot is `{ sheetName: string, columnCount: number, values: unknown[][] }` and includes its header row.
- The helper performs one `values.batchGet` of current full-width ranges followed by one `values.batchUpdate` with padded complete matrices.

- [ ] **Step 1: Write failing payload and validation tests**

Test two sheets with different previous/new heights. Assert one batch read, one batch write, `RAW`, exact full-width ranges, new values at the front, fixed-width blank rows through the old tail, quote escaping in sheet names, and rejection of a row wider than `columnCount`.

- [ ] **Step 2: Run atomic snapshot tests and verify RED**

Run: `node --test test/google-sheets-atomic-snapshots.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `replaceSheetSnapshotsAtomically`**

Normalize every output row to exactly `columnCount` cells. Use a single `spreadsheets.values.batchUpdate` request for all sheets and no `clear`, `update`, or per-sheet write.

- [ ] **Step 4: Run atomic snapshot tests and verify GREEN**

Run: `node --test test/google-sheets-atomic-snapshots.test.js`

Expected: all payload/validation cases pass.

- [ ] **Step 5: Add the request-failure preservation test**

Use a stateful Sheets mock whose `batchUpdate` throws before applying. Assert its previous payment and sales matrices are unchanged and no separate clear/update method is called.

- [ ] **Step 6: Verify the preservation test fails for a deliberately sequential test fixture, then passes through the helper**

Run: `node --test test/google-sheets-atomic-snapshots.test.js`

Expected final result: all cases pass with exactly one attempted batch write.

- [ ] **Step 7: Replace payment handler clear/update calls**

Call the helper once with payments width 11 and sales width 8 after both sheets exist. Preserve the current readback checks and advance `payments_last_success_utc` only after both match.

- [ ] **Step 8: Verify payment staging integration tests**

Run: `node --test test/google-sheets-atomic-snapshots.test.js test/source-sync-marker-wiring.test.js test/payments-staging-verification.test.js test/sync-payments-sale-attribution-wiring.test.js test/sync-payments-sale-staff-wiring.test.js test/sync-payments-direct-employee-wiring.test.js`

Expected: all pass; no test or source path expects a destructive clear.

- [ ] **Step 9: Commit**

```bash
git add lib/google-sheets-atomic-snapshots.js api/sync-payments.js test/google-sheets-atomic-snapshots.test.js test/source-sync-marker-wiring.test.js
git commit -m "fix: publish payment staging atomically"
```

### Task 3: Authenticate balance refresh and webhook modes

**Files:**
- Create: `test/balances-auth.test.js`
- Modify: `api/balances.js:1-40,428-435,520-532`
- Modify: `test/balance-webhook-mirror-only.test.js`
- Modify: `test/balance-data-health-gate.test.js` only if method routing changes its structural offsets

**Interfaces:**
- Consumes: `authorizeBearer` and `authorizeHeader` from Task 1.
- Default `GET` consumes `CRON_SECRET`.
- Webhook `POST` consumes `x-vector-refresh === 'tochka-webhook'` and `x-vector-key` matching `TOCHKA_BRIDGE_KEY || VECTOR_SYNC_KEY`.

- [ ] **Step 1: Write failing balance authorization tests**

Through the real default handler, assert: anonymous/wrong-bearer GET returns 403; POST with only the source header returns 403; POST with a key but no source header is rejected; ordinary POST cannot fall through to the full refresh path; unsupported methods return 405. Keep Google/OIDC unavailable so any dependency access makes the test fail as 500.

- [ ] **Step 2: Run balance auth tests and verify RED**

Run: `node --test test/balances-auth.test.js`

Expected: current anonymous GET or source-only POST reaches dependency initialization instead of returning the required authorization response.

- [ ] **Step 3: Implement explicit method/auth dispatch**

In the default handler, dispatch only verified webhook POST; reject other POST. Require cron bearer for GET before entering the main refresh `try`. In `refreshBalancesFromTochkaWebhook`, repeat/retain the bridge-key guard so direct callers cannot bypass the default dispatcher.

- [ ] **Step 4: Update structural webhook assertions**

Require both `x-vector-refresh` and `x-vector-key`, constant-time helper usage, and authorization before `sheetsClient`/`fetchLiveBalances`. Preserve mirror-only behavior with no decision reconciliation or owner queue.

- [ ] **Step 5: Verify focused balance tests**

Run: `node --test test/balances-auth.test.js test/balance-webhook-mirror-only.test.js test/balance-mirror-only-wiring.test.js test/balance-data-health-gate.test.js test/balance-decision-reconciliation.test.js test/tochka-webhook-readiness.test.js`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add api/balances.js test/balances-auth.test.js test/balance-webhook-mirror-only.test.js test/balance-data-health-gate.test.js
git commit -m "fix: authenticate balance mutation paths"
```

### Task 4: Recognize generated cash transfers by stable marker

**Files:**
- Modify: `lib/finance-reports.js:13-64`
- Modify: `test/finance-reports.test.js:33-38`

**Interfaces:**
- Add internal `cashTransferPart(row) -> { operationId: string, part: number, total: number } | null`.
- Add internal `isPairedCashTransfer(row, next, amount) -> boolean` combining stable-marker and legacy-text recognition with shared structural checks.
- `calculateFinanceReports` continues to skip exactly two validated rows and throw `Unknown report article` otherwise.

- [ ] **Step 1: Write the failing current-production-shape test**

Create adjacent article-less rows with descriptions beginning `Инкас.` and comments `Касса Vercel | PHOTO-X:op1:1/2 | …` and `:2/2`. Assert P&L remains unchanged.

- [ ] **Step 2: Run the current-shape test and verify RED**

Run: `node --test --test-name-pattern="stable marker" test/finance-reports.test.js`

Expected: FAIL with `Unknown report article` because the prose regex does not match.

- [ ] **Step 3: Implement stable-marker recognition**

Parse the marker from column M (`row[12]`), compare operation IDs/parts, and apply the existing date/month/wallet/cent invariants. Keep the existing exact-text path as a fallback.

- [ ] **Step 4: Run the current-shape test and verify GREEN**

Run: `node --test --test-name-pattern="stable marker" test/finance-reports.test.js`

Expected: PASS.

- [ ] **Step 5: Add fail-closed mutation cases**

For operation-ID mismatch, wrong part order, missing marker, same wallet, date mismatch, effective-month mismatch, and one-cent mismatch, assert `Unknown report article`. Keep the existing legacy-pair success and mismatch failure.

- [ ] **Step 6: Run all report tests**

Run: `node --test test/finance-reports.test.js test/google-sheets-finance-reports.test.js`

Expected: all pass; unknown rows remain blocked.

- [ ] **Step 7: Commit**

```bash
git add lib/finance-reports.js test/finance-reports.test.js
git commit -m "fix: classify generated cash transfers by marker"
```

### Task 5: Cross-cutting verification and handoff

**Files:**
- Modify only files already named above if verification exposes a direct regression.

**Interfaces:**
- Consumes all prior task outputs; produces a verified local branch with no production mutations.

- [ ] **Step 1: Run the security and financial focused suite together**

Run: `node --test test/request-authorization.test.js test/sync-payments-auth.test.js test/google-sheets-atomic-snapshots.test.js test/balances-auth.test.js test/balance-webhook-mirror-only.test.js test/finance-reports.test.js`

Expected: zero failures.

- [ ] **Step 2: Run the complete suite outside the restricted sandbox**

Run: `npm test`

Expected: all existing and new tests pass; no cancelled or skipped tests.

- [ ] **Step 3: Inspect the final diff and secret hygiene**

Run: `git diff HEAD~4 --check`, `git status --short`, and a targeted secret-pattern scan over changed files.

Expected: no whitespace errors, no secret values, no deployment/ACL/App Script changes, and only scoped files.

- [ ] **Step 4: Document deployment prerequisites in the handoff**

State that production still requires ACL containment, deployment review, secret rotation, deploy, authenticated smoke tests, and data reconciliation. Do not execute those live actions.

- [ ] **Step 5: Commit any verification-only correction if needed**

If verification required no code correction, do not create an empty commit.
