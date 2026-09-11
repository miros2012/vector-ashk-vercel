# Cash photo direct Gemini implementation plan

**Goal:** Recover the saved Yamskaya photo using GEMINI_API_KEY and remove temporary recovery/OAuth paths after readback.
**Architecture:** Existing health multiplexer, Drive/Sheets store and archive contract remain. Replace only the recognition transport and prompt envelope with official Gemini Developer API generateContent. Keep request/retry time below the health function's 60-second limit.
**Tech stack:** Node 24, native fetch, existing googleapis adapters; no dependencies or new functions.
**Spec:** Owner-provided 2026-09-11 cash-photo handoff in this session.

## Constraints
- No DDS, bank, obligation, formula, Decision Engine or Owner Dashboard mutations.
- API key from process.env.GEMINI_API_KEY; x-goog-api-key header only. No upstream error bodies or raw exceptions in diagnostics.
- Preserve authorization, save-before-recognition, idempotency, exact-F-cell legacy hyperlink reading, archive JSON fields.
- Branch -> RED -> GREEN -> diff review -> PR -> exact merge-ref CI -> merge -> push CI -> exact-SHA READY -> smoke.

## Verified baseline
main/production a5c365674617cfba053517032b9d75b57c37b71f; push CI 34566188791 success; local 721/721. Production key presence confirmed in Vercel UI without revealing it. Drive/archive probe succeeds. Archive row 301 is still failed, exact photo/hash/Drive ID match handoff; gateway credit-card 403 recorded.

## Task 1: Direct client and payload
Files: lib/cash-photo-recognizer.js, lib/cash-photo-prompt.js, api/health.js and respective tests.
- [x] RED: replace Gateway fixtures with native candidates/content/parts; assert official endpoint, header-only key, preserved schema, safe missing-key/network/4xx/malformed errors, bounded 429/500/503 retries, fallback and time budget.
- [x] Run `node --test test/cash-photo-recognizer.test.js test/cash-photo-prompt.test.js` and record expected failures.
- [x] Implement `recognizeWithFallback({apiKey=process.env.GEMINI_API_KEY,payload,models,...})` using fixed `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, `redirect:'error'`, AbortController timeout, safe status-only diagnostics and a 40s total budget.
- [x] Implement native payload: `contents:[{role:'user',parts:[{text:prompt},{inlineData:{mimeType,data}}]}]`, `generationConfig:{responseMimeType:'application/json',responseJsonSchema:schema}`.
- [x] Wire only cash-photo recognition in health; retain unrelated OIDC consumers. Probe checks API-key presence and read-only model metadata, never requests generation publicly.
- [x] Integration regression: upload saves bytes/archive before key failure; transient failure -> safe 202; successful recognition writes only archive; same hash -> no duplicate.
- [x] Full suite and API syntax, review diff, commit, push, PR, merge-ref CI, merge, push CI, exact-SHA production READY.

## Task 2: Production recovery
- [x] Read-only probe must confirm direct Gemini and both configured models support generateContent.
- [x] Re-read row 301; only if still unrecognized call existing exact-target recovery once.
- [x] Read back H:N and A:G. Confirm recognized status, operation/review counts, model, complete JSON, unchanged photo/hash, no duplicate, no DDS effects.

## Task 3: Cleanup
Files: lib/cash-photo-retry-http.js, lib/cash-photo-google-oauth-probe.js, related tests.
- [ ] RED: legacy GET diagnostic/recovery -> 405 with no work; POST branch-token retry remains.
- [ ] Delete temporary branches/helper/tests; preserve normal retry/store compatibility.
- [ ] Full CI, diff review, separate PR/green merge, push CI, exact-SHA READY, health/storage/direct model probe, disabled legacy routes, safe unauthorized upload/retry.

## Official references checked 2026-09-11
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash
- https://ai.google.dev/gemini-api/docs/api-key
- https://ai.google.dev/api/models
- https://ai.google.dev/gemini-api/docs/interactions-overview (generateContent remains supported)
- https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta (native generateContent path and responseJsonSchema verified)


## Recovery acceptance, 2026-09-11
PR #199 merged as 39b1e61b74ee3530e0f24a4965e393bb54817245. Merge-ref run 34570279007 and post-merge run 34570367268 both pass 735/735. Production dpl_4TMZhVmmykyNsQcrargbLg2pL44d is exact-SHA READY; direct key/model metadata and Drive/Sheets probes return 200.
One exact-target recovery returned attempted=1, recognized=1. Connector readback confirms archive row 301 is recognized/pending processing, 11 operations, zero model review flags, model gemini-3.8-flash and valid recognition JSON. Only row301 changed among302 archive rows; photo/hash/hyperlink remain identical, no duplicates. Full DDS formula/value snapshot (18,685 populated rows) is byte-for-byte identical before/after recovery.
Temporary GET recovery and OAuth diagnostics are now removed by the cleanup change; normal authenticated POST retry remains.
