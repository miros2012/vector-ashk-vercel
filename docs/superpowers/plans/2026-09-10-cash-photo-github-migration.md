# Cash photo GitHub/Vercel migration plan — 2026-09-10

## Goal

Move the cash-journal photo upload and recognition path into the canonical `miros2012/vector-ashk-vercel` codebase and remove Gemini/provider outages from the employee-facing upload experience.

This change must not execute payments, bank actions, or silently classify new financial transactions. The accepted financial backend remains unchanged outside the new cash-photo surface.

## Facts established before implementation

- The 2026-09-10 Yamskaya photo `1000056081.jpg` was saved successfully before recognition failed.
- The legacy Apps Script calls Gemini synchronously and surfaces its raw `500/503` diagnostics to the user.
- The legacy recognizer retries each configured model only twice with a short fixed delay.
- Google documents `429`, `408`, and `5xx` as transient errors and recommends exponential backoff with jitter.
- Gemini 3.8 Flash is a stable September 2026 multimodal model.
- Vercel AI Gateway can authenticate deployed functions through `VERCEL_OIDC_TOKEN`, so the new runtime does not need the legacy Gemini key copied from Apps Script.
- Vercel Functions have a 4.5 MB request-body limit. The browser must therefore shrink large photos before upload and the API must enforce a conservative raw-image limit.
- The existing Google service account `vector-ashk-backend@vector-finance-ai.iam.gserviceaccount.com` already writes the finance spreadsheet. The Drive folder used by the finance system must be capability-probed before live photo storage is enabled.

## Slice A — resilient recognition service

### Files
- Create `lib/cash-photo-recognizer.js`
- Create `lib/cash-photo-prompt.js`
- Create `test/cash-photo-recognizer.test.js`

### Behavior
- Preserve the current journal extraction rules and structured result fields (`initialBalance`, `visibleMoneyRowCount`, `finalBalance`, `finalBalanceReadable`, `pageNote`, `operations`).
- Primary model: `google/gemini-3.8-flash` through Vercel AI Gateway.
- Allow model list override through `CASH_PHOTO_MODELS`.
- Retry only transient HTTP/network failures with exponential backoff + jitter.
- Keep provider diagnostics internal; expose a typed retryable error to the API layer.
- Validate that a successful model response contains an operations array.

### TDD
1. Test transient retry + increasing delays.
2. Test model fallback after retry exhaustion.
3. Test non-transient 4xx fails immediately.
4. Test final retryable error has safe public message and separate diagnostics.
5. Test structured JSON extraction.

## Slice B — GitHub/Vercel API and storage boundary

### Files
- Create `lib/cash-photo-store.js`
- Create `lib/cash-photo-upload-service.js`
- Create `api/cash-photo-upload.js`
- Create `api/cash-photo-storage-probe.js`
- Create `test/cash-photo-upload-service.test.js`
- Create `test/cash-photo-upload-route.test.js`

### Behavior
- Accept raw `image/jpeg`, `image/png`, or `image/webp` bytes, not base64 JSON, to stay below Vercel payload limits.
- Validate branch/year/file metadata and a bearer upload token.
- Compute SHA-256 and make retries idempotent.
- Persist the image before recognition. If persistence fails, recognition must not start.
- Append/update `Архив кассовых фото` with a safe state machine: `Загружено` -> `Распознавание` -> recognized state, or `Ожидает распознавания` for transient AI failure.
- A transient AI failure returns HTTP 202 and a user-safe message saying the photo is saved and must not be uploaded again.
- Do not write or classify DDS transactions in this slice.
- Storage probe is read-only by default and is used to verify that the existing service account can access the target Drive folder before cutover.

## Slice C — mobile page and pending retry

### Files
- Create `public/cash-upload.html`
- Create `api/cash-photo-config.js`
- Create `api/cash-photo-retry.js`
- Create tests for token validation, browser-facing safe errors, and retry selection.
- Update `vercel.json` only after the focused tests are green.

### Behavior
- Replace the employee-facing `script.google.com` page with a Vercel-hosted mobile page.
- Client-side resize/compress images that would exceed the safe raw upload limit.
- Never render model names, stack traces, raw HTTP bodies, or provider diagnostics to the employee.
- Scheduled retry picks only archive rows in the explicit pending-recognition state; it never reclassifies financial transactions.
- Existing failed photos can be retried by their archive identity after storage access is verified; employees should not have to take or upload them again.

## Cutover and verification

1. Focused RED/GREEN tests locally for all new pure modules.
2. `npm test` on GitHub Actions for the PR merge ref.
3. Review changed-file diff; no unrelated accepted-v1 financial logic may change.
4. Merge only after CI is green.
5. Verify exact-SHA Vercel deployment is READY.
6. Smoke-test unauthenticated upload/config requests are rejected.
7. Run storage capability probe before enabling live photo persistence.
8. Run a controlled retry of the already-saved 2026-09-10 Yamskaya photo and verify archive state changes without any automatic DDS classification.
9. Only after the controlled retry passes, publish the new mobile upload URL and retire the old Apps Script upload entry point.

## Stop conditions

Stop and report instead of guessing if:
- the service account cannot access the intended Drive storage location;
- AI Gateway/OIDC is unavailable in the production deployment;
- a write would require changing existing financial classifications or performing a payment/bank action;
- the current-day archive contains a new ambiguous financial operation requiring owner confirmation.
