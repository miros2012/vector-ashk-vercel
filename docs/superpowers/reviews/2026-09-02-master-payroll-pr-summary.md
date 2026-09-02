# PR summary — verified full master payroll gross-to-net

This branch implements a staging-only verified payroll calculation for August 2026.

- Full gross includes B + moto + extra moto + trainer.
- Rates are owner-confirmed on 2026-09-02.
- Lesson-priced work is paid by event count; the event-based correction raises the historical B control by 1,000 RUB.
- Only individually attributable evidence reduces outstanding net.
- Fuel/leasing remain blocked without authoritative master allocation.
- Atalykov remains `REVIEW_REQUIRED` because confirmed August settlement/deductions exceed verified ASHK gross by 14,299 RUB.
- Current full verified gross is 2,670,742.50 RUB; confirmed evidence 175,922 RUB; intermediate outstanding net 2,494,820.50 RUB.
- `PROMOTION_STATUS` remains `BLOCKED`.
- `Фонд вождения` is unchanged by this branch.
- No new API route or Vercel function is added.
