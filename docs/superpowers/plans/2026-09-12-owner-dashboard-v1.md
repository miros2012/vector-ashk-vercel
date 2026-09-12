# Owner dashboard v1 Implementation Plan

Goal: protected mobile owner dashboard over the accepted read-only package.
Architecture: static vanilla HTML/CSS/JS, dedicated HMAC session, same-origin read-only API dispatched through existing function.
Tech Stack: Node 24, node:test, Vercel, Google Sheets readonly.
Spec: docs/superpowers/specs/2026-09-09-owner-dashboard-v1-design.md
Global Constraints: no finance writes or recalculation; no missing-to-zero conversion; no additional serverless functions; no secret in browser storage or git.

- [x] Add failing tests for session expiry/tampering, wrong secret, CSRF, methods, auth before reads, no-store and safe failures.
- [x] Implement lib/owner-dashboard-session.js and lib/owner-dashboard-api.js; isolated dispatcher and rewrites.
- [x] Add projection tests for missing versus zero, blocked withdrawal and source-limited forecast; implement lib/owner-dashboard-view-model.js.
- [x] Add public/owner/index.html, styles.css, app.js with login/logout, money, forecast, sales, obligations, fund, actions, data health and honest unavailable states.
- [x] Run full node:test regression and independent security/contract review; fix findings.
- [ ] Publish PR, green CI, review diff, merge, verify exact-SHA deployment and production route protection. Authenticated live acceptance requires dedicated production secret configured through an authorized channel.

Validation: 790 node:test checks pass. Independent review found and fixed blocked-zero withdrawal and incomplete obligation totals. Browser cannot open local preview (ERR_BLOCKED_BY_CLIENT); production login screen must be checked after deployment. Authenticated live acceptance remains gated on production secret configuration.

Activation: configure a unique random 32+ character VECTOR_OWNER_DASHBOARD_SECRET in Vercel Production, then redeploy. Use its value at /owner/. Never reuse the staff upload token or finance integration credentials. Rotation invalidates all sessions. No code or data operations are required from staff.
