# Production P0 Hardening Design

## Purpose

Close the code-level P0 findings from the 2026-09-26 independent audit without changing production infrastructure, Google Sheets ACLs, Apps Script deployments, or secret values. Preserve the existing fail-closed finance model: incomplete or unverifiable facts must continue to block reports and decisions.

The change covers four connected production flows:

1. authenticate payment staging before any upstream or Google call;
2. authenticate every balance mutation path and make route methods unambiguous;
3. publish the two payment staging snapshots without a clear-before-write loss window;
4. classify generated cash-transfer pairs by stable machine evidence instead of Russian prose alone.

## Constraints

- Do not add an API function, paid service, database, queue, or secret.
- Keep the existing `POST /api/sync-payments` and `/api/balances` routes.
- Keep current orchestrator compatibility: internal finance callers already forward `Authorization: Bearer <CRON_SECRET>`.
- Keep the Render bridge contract: `x-vector-refresh: tochka-webhook` identifies the source and `x-vector-key` proves possession of `TOCHKA_BRIDGE_KEY`, falling back to `VECTOR_SYNC_KEY` only for the existing compatibility period.
- Perform authorization before creating Sheets clients, fetching ASHK, obtaining Vercel OIDC, or writing state.
- Never expose configured or provided secret values in responses or logs.
- Preserve report fail-closed behavior for genuinely unknown financial rows.
- Do not modify production, deployment configuration, ACLs, triggers, or environment values in this implementation package.

## 1. Shared request authorization

Use `lib/secret-compare.js` for constant-time secret equality. Add focused parsing/authorization helpers only where they prevent duplicated security behavior; do not create a general authentication framework.

### Payment staging

`POST /api/sync-payments` requires a bearer token exactly equal to non-empty `CRON_SECRET`. Missing configuration, missing credentials, malformed authorization, or a wrong token returns `403` with a generic body before any dependency is initialized. Other methods continue to return `405` before authorization.

Existing nightly, intraday, recovery, and manual finance callers remain compatible because they already invoke the handler with the cron bearer token.

### Balances

The route has two explicit modes:

- `GET /api/balances`: full refresh/reconciliation path, requiring `Bearer CRON_SECRET` before Sheets or Tochka access;
- `POST /api/balances` with `x-vector-refresh: tochka-webhook`: mirror-only webhook path, requiring a non-empty `x-vector-key` that constant-time matches `TOCHKA_BRIDGE_KEY`, or the existing `VECTOR_SYNC_KEY` fallback.

All other `POST` requests are rejected. The public source label is routing metadata, not authentication. The existing authenticated `refreshBalancesMirrorOnly` export keeps its current cron authorization.

No anonymous request may return cached data through this mutation route. Read-only public health remains on the existing health surface.

## 2. Atomic payment staging publication

Replace the four-step sequence

1. clear payments;
2. update payments;
3. clear sales;
4. update sales;

with one `spreadsheets.values.batchUpdate` request containing both complete snapshots.

Before publishing, read the current populated rows of each staging sheet to determine the previous extent. Build a rectangular payload for each range whose height is `max(previous row count including header, next row count including header)`. New rows occupy the beginning; any obsolete trailing rows are represented by fixed-width empty cells. The two ranges are sent in one batch request with `valueInputOption: RAW`.

Consequences:

- a request-level failure leaves the prior Sheets state unchanged;
- payments and sales advance together;
- a shorter new snapshot cannot leave stale rows behind;
- existing sheet names and consumers remain unchanged;
- source-success markers advance only after the existing readback verification succeeds.

The implementation must reject rows wider than their declared schema rather than silently truncating them.

## 3. Stable cash-transfer recognition in P&L

Generated cash DDS rows already carry a machine comment shaped as:

`Касса Vercel | <operation-id>:<part>/<total> | <branch>`

For an article-less adjacent pair, the report calculator first attempts stable-marker recognition:

- both comments contain the same non-empty operation ID;
- the parts are exactly `1/2` followed by `2/2`;
- both rows have the same effective P&L month and date;
- both wallet codes are positive and distinct;
- the first amount is negative and the second is its exact cent-level opposite;
- both article cells are blank.

If those checks pass, the pair is an excluded internal transfer regardless of human description, including current abbreviated `Инкас.` text.

For historical rows that predate the machine marker, retain the existing exact `Инкассация … — перевод из/поступление в …` fallback with all current amount/date/month/wallet checks. Any row satisfying neither mechanism remains `Unknown report article` and blocks publication.

## 4. Error handling and observability

- Authorization failures return `403 { ok: false, error: 'forbidden' }` and perform zero upstream calls.
- Unsupported methods return `405` with the existing generic method error.
- Staging publication/readback failures retain the existing generic external response and safe logging.
- Webhook authentication failure returns `403` before Vercel OIDC, bank, or Sheets access.
- No response adds secret, credential, raw bank payload, or personal-data fields.
- Existing decision and report validation errors remain fail-closed.

## 5. Testing strategy

Use red-green-refactor for each behavior.

### Authorization tests

- Payment sync rejects absent/wrong bearer before ASHK or Sheets calls.
- Payment sync accepts the configured cron bearer through its real handler boundary.
- Default balance GET rejects absent/wrong bearer before any Sheets/OIDC/bank call.
- Webhook rejects the public source header without the bridge key.
- Webhook accepts the correct bridge key, rejects a wrong value, and does not log either.
- Non-webhook POST cannot enter the ordinary refresh path.

### Atomic publication tests

- One `values.batchUpdate` contains both staging ranges.
- A shorter snapshot pads the old tail with empty fixed-width rows.
- An injected batch failure leaves the mock's prior snapshots intact and does not advance success markers.
- Readback mismatch still returns failure and does not advance markers.

### Report tests

- A generated marker pair with abbreviated descriptions is excluded.
- A marker-ID mismatch, reversed/missing part, same wallet, date/month mismatch, or cent mismatch remains blocked.
- Legacy exact-text pairs continue to work.
- A truly unknown article continues to block publication.

Run focused tests after every TDD cycle, then run the complete `npm test` suite outside the restricted sandbox because several existing tests bind a loopback port.

## 6. Acceptance criteria

The implementation is acceptable when:

1. unauthenticated payment and balance requests cannot initialize any external dependency;
2. the webhook requires actual secret possession, not just a public constant header;
3. payment and sales staging publish in one batch with stale-tail removal and no destructive pre-clear;
4. the current abbreviated cash-transfer shape calculates without weakening unknown-row validation;
5. all new focused tests pass after being observed failing first;
6. the entire existing test suite passes;
7. `git diff` contains no production secrets, environment values, deployment changes, ACL changes, or unrelated refactors.

## 7. Deferred production work

The following audited P0 work is intentionally outside this code package and requires a separate live-change authorization:

- remove `anyone:writer` from the financial workbook;
- restrict/retire Apps Script web-app deployments and verify their exact deployed source;
- rotate bridge, ASHK, bank, AI, cron, and synchronization credentials after access containment;
- deploy the reviewed commit and perform authenticated smoke tests;
- reconcile the current finance cycle and reopen the decision gate only after all data-quality gates pass.
