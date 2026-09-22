# Resumable finance cycle

Approved user outcome: complete the existing import → reports → validation chain without requiring manual repairs, preserve progress across timeouts, and never report full success for a partial run. Existing permission covers branch, PR, merge after CI, deployment and finance verification. No payments or new accounting classifications.

## Evidence
The production cycle exceeded 300 seconds. Only receivablesSource/ropPublish had durable retry state; other stages and the tail shared the same invocation. A data-health check could report OK after an upstream failure. API writes do not trigger the legacy P&L onEdit handler.

## Design
Keep existing authentication and shared orchestration lease. Add a single JSON checkpoint in __vercel_control with cycle ID, mode, ordered cursor, stage attempts/results, timestamps and last completed cycle. Persist RUNNING before each stage; an expired invocation resumes that stage and never skips it. Save success before advancing. Process one stage per HTTP call so slow independent stages cannot consume one another's runtime. Existing scheduled recovery continues unfinished cycles. The signed GitHub recovery worker drains pending successful steps with a bounded loop; failures remain visible and retry on the next scheduled call. Stop automatic retries after three failures at one stage; a normal new cycle can retry blocked work without skipping its stage.

Stages: tochkaDds, reports, payments, hours (full only), receivablesSource, ropPublish, balances, reportVerification, dataHealth, decisions. Owner queue remains on its separately authorized existing path; do not add owner actions to a recovery worker. Legacy orchestrator modules remain for compatibility; production routing uses the new cycle.

P&L calculator mirrors saved legacy semantics: expense period L falling back to B, directory inclusion C and group E, gross revenue from Данные АШК with separate refunds; no assumption that current month revenue exists. Write numeric B4:M14 values only after validating the exact existing layout and inputs, preserving formatting. Re-read and compare inputs/output before marking verified. Empty or malformed sources, unknown material articles, conflicting directory definitions, and changed snapshots fail closed. Preserve historical months' inputs; never substitute staging September payments for August revenue.

Status is independent from financial-data quality: cycle state must be COMPLETE and reports verified to show overall OK. A read-only status response includes current stage, pending/failed state and last successful completion. Authenticated data-health and owner-package readers combine the legacy source-quality snapshot with cycle state and a current read-only report/source comparison; source quality may remain OK while overall status says updating/failed. A crash leaves RUNNING rather than stale success. Report verification happens again before the data-health/decision tail.

## Boundaries and risks
Google Sheets remains the persistence backend; no new infrastructure or credentials. Late independent bank/cash writes can invalidate a report; final verification must recalculate and compare, and refresh deterministically when needed. Apps Script source is outside this repository: do not claim it was deployed or disable it without access. The new report calculation uses its canonical inputs. Existing legacy retry state is preserved for audit but superseded by the new checkpoint only after migration is explicitly recorded.

Acceptance: regression tests for crash/restart, failed checkpoint, concurrent lease, source/report mismatch and missing revenue; full suite and CI; production repeated continuation with COMPLETE only after actual verified stages. If a single stage still exceeds 300 seconds, it must be split further rather than called successful.
