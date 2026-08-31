# August Hours Ledger Reconciliation

**Goal:** Use ASHK's documented period-aware instructor timesheet endpoint to produce an auditable August 2026 hours total and reconcile it with the existing 5,870 and 7,319 controls.

**Architecture:** Add a small pure module for URL construction, response validation, and privacy-safe aggregation. Expose it through a read-only Vercel diagnostic route that calls `MasterWorkReportDetails` for a bounded period and returns only totals, date bounds, and session-type breakdowns.

**Safety:** The route performs GET requests only, makes at most two ASHK requests per invocation, does not expose the API key, and omits student, contract, instructor, and vehicle details from its response.

## Tasks

1. Add failing unit tests for exact ASHK query parameters, response validation, and hour aggregation.
2. Implement the pure report helper until the tests pass.
3. Add a read-only Vercel handler for August 2026 and configure its execution duration.
4. Validate syntax and tests locally.
5. Deploy the branch, confirm `READY`, invoke the exact preview route, and record both build modes.
6. Compare the result with the Google Sheet controls and document what each number measures.

