# Finance Stability Hardening Design

## Goal

Reduce recovery transport failures and establish continuous production evidence without changing financial facts, weakening fail-closed gates, or introducing shared secrets.

## Scope

1. Every production finance-cycle HTTP invocation advances at most one durable checkpointed stage. GitHub recovery may still drain the cycle by making separate signed requests, one stage at a time.
2. A dedicated least-privilege GitHub workflow verifies the production Owner Package once per day through the existing OIDC endpoint.
3. Scheduled smoke authorization is bound to the exact repository, `main` ref, dedicated workflow path, hosted runner, and deployed commit SHA. The existing owner-triggered manual smoke remains supported.

## Safety constraints

- Never classify, rewrite, or synthesize financial records.
- Preserve all Data Health, reconciliation, completeness, and safe-withdrawal fail-closed behavior.
- Do not add repository or GitHub secrets.
- Do not broaden the scheduled identity to the general hourly workflow.
- A deployment/workflow SHA mismatch must fail closed.

