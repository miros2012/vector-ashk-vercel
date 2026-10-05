# Audit remediation — 2026-10-05

Approved by Miroslav's repeated instruction to implement the audit fixes.
Base: origin/main b96ae488ac4f3092b9dd6f040c2b40b08e0e923f.

## Goal and constraints

Protect the last successful source snapshot against failed writes and prevent
unauthenticated access to financial diagnostics. Financial facts, classifications,
source imports in production and ambiguous obligation matching are out of scope
for this code-only release. September reconciliation is not declared complete.

## Architecture

Reuse the existing single-batch snapshot replacement used by payment staging.
All three remaining clear-then-update paths must preserve prior data on a failed
write and erase obsolete tail rows on a successful shorter snapshot. ROP publish
must verify every cell, not just the header and row count. Diagnostic GETs must
use the existing timing-safe Bearer authorization before any external I/O; the
GitHub OIDC finance_sync POST remains unchanged.

## Tasks

1. Add route-level failure/tail regression tests. Switch hours staging, finance
   source staging and ROP target publication to atomic snapshot replacement.
2. Add same-size corrupted ROP readback regression. Verify the complete snapshot,
   accounting for Google Sheets omitted trailing empty cells.
3. Add diagnostic access tests for both routes (missing, wrong and empty secrets,
   authenticated entry and unsupported methods). Enforce auth before I/O.
4. Run the full test suite and one fresh whole-branch read-only review. Resolve
   important findings, commit and prepare the reviewed change for delivery.

## Review focus and remaining work

Check source callbacks, grid expansion, stale tail clearing, auth ordering and
preservation of OIDC POST dispatch. Regression tests replace external I/O only.
Separate follow-up work requires September primary payments/accrued-revenue
exports, exact obligation evidence, immutable cash provenance repair and verified
Apps Script ownership/backup before changing legacy triggers. None is represented
as fixed by this release.
