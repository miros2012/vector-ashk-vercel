# DEP0169 Google Sheets client construction trace — 2026-09-08

## Scope

This bounded diagnostic follows the controlled runtime trace from #169. It tests the actual non-network Google API construction pattern used by production code in `api/nightly-finance-orchestrator.js` and `api/decision-event.js`:

- `new google.auth.JWT(...)`
- `google.sheets({ version: 'v4', auth })`

It does not authorize the JWT, call Google APIs, mutate production dependencies, or change runtime behavior.

Baseline: `main` at `845f995fe0bccebef41dc22f10eec49bce3f98ad`.

## Why this is the next falsifiable check

The installed dependency inspection previously found one static legacy parser call-site in `googleapis-common@8.0.3` at `build/src/discovery.js:111`. The controlled #169 experiment proved that the `Discovery.discoverAPI()` call-site is runtime-reachable but does not emit DEP0169 from the ordinary installed `node_modules` topology on Node 24.20.0, while an application-level `node:url.parse()` positive control does emit DEP0169.

The remaining question for our actual production usage is narrower: does constructing the JWT and generated Google Sheets v4 client itself exercise a deprecated URL parser path?

## TDD evidence

- RED run `34198045890`: dependency install and API syntax checks completed, then the suite failed because the new `traceGoogleSheetsClientConstructionDep0169` contract had no implementation yet.
- GREEN run `34198116463`: dependency install, API syntax checks and the full test suite completed successfully.

The Green contract proves, on the repository's Node 24 CI runtime, that:

- the dummy JWT object is constructed;
- the generated Google Sheets v4 client is constructed;
- no network request or JWT authorization is performed;
- the trace harness sees no `DEP0169` warning during that production-like construction;
- the existing application-level `node:url.parse()` positive control still emits `DEP0169`, so the trace mechanism remains able to observe the warning.

## Conclusion

Current evidence does **not** justify changing `googleapis`, `googleapis-common`, or any other dependency to address the historical production warning. The static discovery call-site exists, but the production-like Google Sheets client construction used by this project is silent under the same Node 24 trace harness.

This does not prove that every historical Vercel warning came from a different source. A future recurrence should still be correlated with an actual production stack or exact deployed/bundled artifact before remediation.

The latest checked Vercel production log window contained no new `DEP0169` events.

## External Owner smoke gate remains unchanged

The authenticated Owner-package smoke is still externally blocked until Vercel production receives a new dedicated `VECTOR_OWNER_PACKAGE_KEY` and a redeploy. The key must not be sent through GitHub or chat and must not reuse `VECTOR_SYNC_KEY` or `TOCHKA_BRIDGE_KEY`. This diagnostic does not create, expose, reuse, or bypass that secret.

## Safety invariants preserved

- no payments or transfers;
- no bank-operation changes;
- no classification of deferred Tochka→DDS operations;
- no writes to DDS, obligations, or other factual financial registers;
- no operating-reserve assumption;
- no auth or route changes;
- no dependency changes;
- no restoration of `DriveWalletOperationList`/`Tokens` for HOURS;
- production HOURS remains on `MasterWorkReportDetails`.
