# Vector Finance System — repository instructions

This repository is the backend for the Vektor financial system and Owner Dashboard. It is not the AI Trading Desk project.

## Safety and financial correctness

- Treat Google Sheets, Tochka and ASHK data as financial source data. Never invent, infer or silently classify a payment when evidence is missing.
- Preserve fail-closed behavior. If Data Health, source freshness, queue integrity, readback verification or reconciliation is uncertain, block downstream decisions and writes.
- Never expose secrets, personal data, raw ASHK responses, Google service-account material or payment details in logs, public API responses, issues or pull-request bodies.
- Do not write to production Google Sheets, Vercel, Render, Tochka or ASHK from an automated coding task.
- Do not add new public routes, cron schedules or Vercel functions unless the issue explicitly requires them and the existing Hobby limits are verified.
- Keep Owner Dashboard / AI CFO work separate from operational finance and from AI Trading Desk.

## Development process

- Work on exactly one scoped issue at a time.
- Use test-driven development for every behavior change: add a failing regression test, observe the failure, implement the smallest fix, then run the full suite.
- Run `find api -type f -name '*.js' -print0 | xargs -0 -n1 node --check` and `npm test` before proposing a pull request.
- Keep changes small, reversible and compatible with existing spreadsheet layouts unless the issue explicitly authorizes a schema change.
- Do not edit `.github/workflows/hourly-project-continuation.yml` from an hourly agent task.
- Never push directly to `main`. Automated work must be proposed through a pull request.
- Stop without changing code when the issue is ambiguous, depends on missing business evidence, requires credentials, or could alter live financial figures.

## Code conventions

- Use Node.js ES modules and the built-in `node:test` framework used by the repository.
- Prefer pure functions and dependency injection for external systems.
- Keep public errors generic and privacy-safe; log only aggregate, non-sensitive diagnostics.
- Preserve deterministic ordering, idempotency, bounded Google Sheets ranges and readback verification.
