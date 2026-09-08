# DEP0169 static dependency inspection — 2026-09-08

## Scope

This report records a read-only static inspection of the dependency tree installed by the existing Node 24 CI workflow. It does not change dependency versions, runtime behavior, authentication, financial routes, or financial data.

## Evidence

Baseline main before the inspection: `6593602eb21fae40eca1d7c0fb95d40b57ba3d3d`.

The TDD RED run installed dependencies successfully and failed only because the new inspector module did not yet exist: 632 tests, 631 passed, 1 expected failure.

The GREEN run used Node 24.20.0 / npm 11.19.0, installed 110 packages, scanned 1,941 JavaScript dependency files, and found exactly one statically identifiable legacy Node URL parser call-site:

- package: `googleapis-common@8.0.3`
- file: `node_modules/googleapis-common/build/src/discovery.js`
- line: 111
- call: `const parts = resolve.parse(apiDiscoveryUrl);`

The project-level runtime guard remains clean: application sources under `api/` and `lib/` contain no direct legacy Node `url.parse()` use.

## Interpretation

This proves the exact legacy parser call-site that remains in the dependency tree resolved by the current CI install. It does not by itself prove that this discovery-path call caused every historical Vercel DEP0169 warning: the currently available Hobby runtime-log window contains no new DEP0169 event with a stack trace, so historical runtime reachability cannot be reconstructed from retained logs.

No dependency was upgraded, downgraded, patched, or overridden on the basis of this static evidence. If DEP0169 recurs, the next diagnostic priority is a runtime stack/trace tied to the warning before changing dependencies.

## Safety invariants

- Production HOURS remains on `MasterWorkReportDetails`; `DriveWalletOperationList/Tokens` is not restored.
- No payment, transfer, bank-operation mutation, DDS/obligation write, or deferred Tochka classification is performed by this diagnostic.
- Owner authentication and the protected read-only Owner package are unchanged.
- Operating reserve remains an external business input; this diagnostic does not infer one.
