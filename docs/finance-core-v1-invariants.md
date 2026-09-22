# Finance Core v1 invariants

## Cash
- Stable branch identity is the wallet code in `Кошельки наличных`; never bind LIVE cash to physical row numbers in `Контроль кассы`.
- `Кошельки наличных!F:J` stores the latest recognized/verified branch cash snapshot.
- `Кошельки наличных!M:Q` stores the reconciliation checkpoint: confirmed cash balance, last DDS row, checkpoint photo ID, timestamp and mode.
- Current cash reconciliation considers only DDS and draft movements created after the checkpoint. Historical pre-checkpoint rows remain an accounting/P&L backlog and must not reappear as a physical cash discrepancy.
- Historical recognized-photo backfill is stage-only. It must never auto-write money into DDS.
- A repeated upload of an already recognized identical journal photo is an idempotent freshness verification: no new Drive file, OCR, draft row or DDS row may be created.

## Bank → DDS
- Safe repeatable counterparty mappings live in `Справочник контрагентов`.
- Ambiguous counterparties (for example, counterparties used for multiple purposes) remain manual and must not get a broad auto-rule.
- The normal auto-import queue is WAIT, not a data-integrity failure. Manual ambiguous classification is a completeness blocker.

## Obligations
- Use lifecycle statuses rather than inferring overdue from date alone: `Ожидаем счёт` → ready/payable → overdue → paid.
- `Ожидаем счёт` amounts stay reserved in forecast but are not reported as overdue.
- September royalty is LIVE forecast until month close; only then may it be frozen as a final obligation.

## Decision gate
The owner decision gate is separate from business risk:
1. Freshness
2. Completeness
3. Reconciliation integrity

Sales-plan deficit, driving-fund deficit and other business risks remain visible but do not masquerade as broken data.

## CI
Production smoke must wait long enough for the exact Vercel SHA to become READY. A slow deployment is not a product failure.
