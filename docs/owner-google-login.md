# Owner Google login

User approved replacing the copied-key login with Google login for the existing owner only.

## Activation (pending Web client registration)

1. In Google Cloud project vector-finance-ai, create an OAuth client of type Web application.
2. Authorized JavaScript origin: https://vector-ashk-backend.vercel.app (no path).
3. This GIS popup/callback flow does not need an authorized redirect URI or client secret.
4. Configure VECTOR_OWNER_GOOGLE_CLIENT_ID in Vercel Production (or the public constant in lib/owner-google-config.js).
5. Set VECTOR_OWNER_GOOGLE_SESSION_SECRET to a NEW random 32+ character secret in Production and redeploy. Never reuse VECTOR_OWNER_DASHBOARD_SECRET or other integration credentials. The new secret is server-only and never entered in the website.
6. Test the real owner Google login, wrong-account rejection, data read and logout. Until this is done, do not claim end-to-end Google sign-in acceptance.

The approved owner's verified Gmail address is pinned by normalized SHA-256 in owner-google-config.js. Dots in the local Gmail name normalize identically. The Google token signature, audience, issuer, expiration, verified email and browser-bound nonce must all pass. No Google Drive permissions or refresh token requested. Existing cash-photo OAuth is independent.

## Security and compatibility

An empty client ID preserves the existing key UI/API until Google is configured. Once configured, key login is rejected and previous key sessions no longer authenticate. Missing Google session secret fails closed, including when the legacy key is still configured. Google-mode sessions use their separate secret and bind to client ID and owner hash. Cookie lifetime remains eight hours.

The sign-in challenge lasts ten minutes in a Secure/HttpOnly/SameSite=Strict host cookie; credential submission additionally requires exact same Origin. The UI loads the official GIS library only when sign-in is needed, and provides retry on network failure. No token, credential, or finance payload is persisted in browser storage. No financial writes added, no new serverless function.

References:
- https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
