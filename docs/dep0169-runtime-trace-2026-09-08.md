# DEP0169 controlled runtime trace — 2026-09-08

## Scope

This diagnostic stage investigates the historical Node `DEP0169` (`url.parse()`) warning without changing production dependencies, routes, authentication, financial behavior, or runtime flags.

Baseline for the stage: `main` at `439183bc6169ffc69a35797d174ffc0bbed9a779`.

The existing static dependency inspection identifies exactly one installed dependency call-site under Node 24.20.0 / npm 11.19.0:

- package: `googleapis-common@8.0.3`
- file: `node_modules/googleapis-common/build/src/discovery.js`
- line: `111`
- source: `const parts = resolve.parse(apiDiscoveryUrl);`

No direct legacy Node URL parser call exists in production `api/**/*.js` or `lib/**/*.js` according to the existing regression guard.

## Controlled runtime experiment

`lib/legacy-url-parse-runtime-trace.js` is a test-only diagnostic harness. It starts a child Node 24 process with `--trace-deprecation` and invokes the installed `googleapis-common` `Discovery.discoverAPI()` against a unique missing local file path.

The missing local target is intentional. It prevents an external network request while still forcing `Discovery` through the statically identified `resolve.parse(apiDiscoveryUrl)` call-site before the subsequent local file read fails with `ENOENT`.

The harness captures at most 1 MiB and exposes only bounded diagnostic facts. It does not return raw stack output, credentials, financial data, or environment secrets.

## TDD evidence

The first runtime hypothesis was deliberately falsifiable: if the installed dependency call-site were the direct source of the historical warning in an ordinary Node 24 `node_modules` layout, the controlled invocation should emit `DEP0169` under `--trace-deprecation`.

- Run `34196191190`: the dependency call was reached and produced the expected `ENOENT`, but no `DEP0169` warning was emitted. Suite result: 640 tests, 639 pass, 1 expected diagnostic failure.
- A follow-up pending-deprecation probe in run `34196415990` also remained silent for that dependency call-site on Node 24.20.0. Suite result: 641 tests, 640 pass, 1 diagnostic failure. This is recorded as observed behavior for this runtime, not as a general promise about every Node build or packaging topology.
- The final harness adds a positive application-level control using `node:url.parse()` from application code under the same `--trace-deprecation` mechanism. Run `34196665090` proves the harness itself can observe `DEP0169`: the application control emits the warning while the installed `googleapis-common` call remains silent. Full suite: 641/641 green.

Node 24 documentation classifies DEP0169 as an application deprecation. The controlled result is therefore consistent with a distinction between application code and ordinary code loaded from `node_modules`.

## Conclusion

The exact installed `googleapis-common@8.0.3` call-site is **runtime-reachable**, but this experiment does **not** prove it is the origin of the historical production warning. In the ordinary installed dependency topology used by GitHub Actions on Node 24.20.0, executing that call-site does not emit DEP0169, while an application-level control does.

Therefore no dependency upgrade, downgrade, override, patch, or production code change is justified by this evidence alone. A future recurrence should be diagnosed from a real production deprecation stack or from the exact deployed/bundled artifact and runtime topology, rather than inferring the root cause from the static dependency match.

A production log query over the most recent checked 24-hour window returned no new `DEP0169` events. Absence in that window is not treated as closure of the historical warning.

## Unrelated external gate intentionally untouched

The authenticated Owner-package smoke still depends on a dedicated production `VECTOR_OWNER_PACKAGE_KEY` being created in Vercel and a production redeploy receiving it before a new owner-triggered `owner-package-smoke` run can succeed. This diagnostic stage does not create, reuse, expose, or bypass that key.

## Safety invariants preserved

- no payments or transfers;
- no bank-operation changes;
- no classification of deferred Tochka→DDS operations;
- no writes to DDS, obligations, or other factual financial registers;
- no operating-reserve assumption;
- no restoration of `DriveWalletOperationList`/`Tokens` for HOURS;
- production HOURS remains on `MasterWorkReportDetails`.
