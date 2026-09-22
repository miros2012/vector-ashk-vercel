# Preserving reconciled bank operations

The importer must distinguish lost writes from deliberate manual allocation.
Bank identity is the account/transaction key in a `Точка API | ...` marker;
owner notes before or after the marker are not part of the key.

For a confirmed replacement (including a split), retain exactly one journal
entry and set its existing result column E to:

```text
Учтено вручную | {"rows":[10,11],"amount":-300,"date":"2026-09-21","wallet":1,"reason":"Owner-approved split"}
```

The example uses synthetic data. Journal columns A–D retain the original key,
transaction ID and timestamps. Never mark an unexplained disappearance as a
replacement. Reference only the retained outgoing/incoming allocations, not
both sides of an internal transfer.

On every run the importer reads those exact DDS rows and verifies their total
in kopecks, sign, cash date, wallet and classification. Each retained row may
belong to only one replacement decision. An additional original bank row,
missing allocation, changed amount, moved row, malformed decision, or duplicate
journal key blocks the import. Correct the evidence after deliberate row moves.
Ordinary imported entries still recover genuinely missing DDS writes.

Rollout: record the approved evidence and archive/clear the extra original rows
atomically; preserve row numbers and cash checkpoints. Run the new importer
twice and verify no duplicate reappears. Do not erase the journal key.

## Generated financial reports

The legacy Sheets automation owns the generated `P&L`, `ДДС: Сводный` and
`Проверка финансов` outputs. They are not durable correction registers. The
saved legacy implementation `financeBuildPNL_` clears/rebuilds P&L, reading
revenue from `Данные АШК`, expense groups from `Справочник статей`, and amounts
and accounting months from DDS. The deployed Apps Script source is outside this
repository; do not claim a Vercel change deploys it.

Persist corrections in those canonical inputs and verify generated outputs
after the existing refresh runs. Do not fight the producer by periodically
restoring hand-edited report formulas. Payment revenue must be gross before
the separate refund deduction; payroll category/group and accounting period
must follow owner confirmation. Source reconciliation exceptions remain open
even when the report's category-completeness check says OK.

Regression coverage: annotated single transactions, current/historical manual
splits, missing/changed evidence, conflicting original rows, malformed/duplicate
decisions, unchanged lost-write recovery, and two consecutive runtime no-ops.
