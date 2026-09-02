# PR #22 rate-model conflict — BLOCKED

During post-PR source reconciliation on 2026-09-02, an existing payroll workbook `АВГУСТ 2026 г.` / sheet `ЗП инструктора Август` was discovered. It contains per-master lesson rates and deduction structure that materially differ from the temporary universal ASHK rate model used in PR #22.

Examples:
- Аталыков: main 2h lesson 1,000 RUB; extra lesson 1,500 RUB.
- Бондаренко: main 670 RUB; extra 700 RUB.
- Герман: main 1,070 RUB; extra 1,500 RUB.
- Степанов: main 1,100 RUB; extra 1,500 RUB.
- Нафиков has an already-filled August example: 3 main lessons × 670 + 2 extra lessons × 700 + 3 internal outputs × 200 = 4,010 RUB, whereas the temporary universal model produced 7,047 RUB for him.

Therefore:
- 2,670,742.50 RUB from the current PR is NOT approved as actual master payroll gross;
- `Фонд вождения` must remain unchanged;
- PR #22 stays draft/BLOCKED;
- next implementation must ingest per-master rate cards and additional non-ASHK payroll components before gross-to-net promotion.

The prior 383 RUB/acad-hour figure remains useful only after its business meaning is explicitly confirmed (for example normative reserve/planned cost), not as an assumed universal actual payroll rate.
