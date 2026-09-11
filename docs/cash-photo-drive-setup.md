# Cash photo: connect the owner's Google Drive

The backend now uses a user OAuth credential to create photos. Google service accounts cannot own files in My Drive. Existing photos are still read with the existing service account; the setup grants that account **reader** access to the new folder. Sheets and direct Gemini authentication are unchanged.

Branch authentication now reads SHA-256 hashes and branch identities only from the private `CASH_PHOTO_ACCESS_JSON` Vercel variable. It never reads authentication data from the publicly shared finance spreadsheet. Keep the generated branch links private and distribute each branch's link only to that branch. Revocation means disabling that registry entry or replacing its hash, then redeploying.

## One-time owner setup

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview?project=vector-finance-ai) in project `vector-finance-ai`.
2. If prompted, configure Branding with app name **Вектор — кассовые фото**, the owner's support email, and developer contact email. Select External audience if Internal is unavailable. Fill the public URLs and authorized domain listed below, then Save. Missing homepage or privacy-policy URLs can disable Publish app.
3. In Data Access, request only `https://www.googleapis.com/auth/drive.file`. This is a non-sensitive per-file scope; do not add full Drive access.
4. For persistent production use, set Audience / Publishing status to **In production** before consent. External apps left in Testing receive seven-day refresh tokens for this scope. Follow any Google verification requirements shown for the project.
5. In Clients, create **Desktop app**, named **Vector cash photo setup**, and download its JSON to the owner's Mac. Do not send its contents or screenshots of secrets to chat or GitHub.
6. On that Mac, use Node.js 24 and a current checkout of this repository, run `npm install`, then:

   ```bash
   node scripts/setup-cash-photo-drive.js --client /absolute/path/to/downloaded-client.json --out /absolute/path/to/new-private-directory
   ```

   The output directory must not already exist and must be outside the repository. Open the printed Google authorization link **on the same Mac**. Choose the account that should own the photos and grant the requested permission. The local callback uses PKCE and random state; no authorization code needs to be copied into chat.

7. The script creates or reuses its own marked folder **Кассовые фото — загрузка API**, grants the existing backend service account reader access without email notification, and saves two files with mode `0600` inside a new directory with mode `0700`:
   - `vercel.env`: five configuration variables, including the refresh token and the hash-only branch registry.
   - `branch-links.txt`: nine independent branch links. These are bearer credentials; do not publish this file or place links in the public spreadsheet.

8. In [Vercel environment settings](https://vercel.com/miroslavshd-5827/vector-ashk-backend/settings/environment-variables), import `vercel.env` for **Production** only. Do not replace existing service-account, Gemini or unrelated variables. Redeploy the reviewed main commit with the new environment.
9. Verify exact-SHA READY, then run the production acceptance below. After setup the Mac does not need to stay on; Vercel refreshes its access token.

If consent or setup fails, the script prints only a fixed safe error. Do not paste credentials for troubleshooting. Check the selected project/account, Desktop client type, publishing status, and that the output path is new and outside the checkout. A rerun reuses the marked folder instead of creating another; the previous branch links remain valid until the registry is replaced in Vercel.

## Google Branding fields

Use these pages after the commit adding them is deployed to Production and both URLs return 200 without authentication:

| Field | Value |
| --- | --- |
| App name | Вектор — кассовые фото |
| User support email / Developer contact information | `miroslav.shd@gmail.com` |
| Application home page | `https://vector-ashk-backend.vercel.app/cash-photo.html` |
| Application privacy policy link | `https://vector-ashk-backend.vercel.app/cash-photo-privacy.html` |
| Application terms of service link | Leave empty; optional in Google's brand-verification documentation |
| Authorized domains → Add domain | `vector-ashk-backend.vercel.app` (no scheme or path) |

The public homepage explains the app and links to the privacy page; it contains no branch links or archive IDs. The upload form also links to the policy and names the storage and recognition providers. If the support contact or actual data handling changes, update both the public pages and Google Branding.

`vercel.app` is listed in the Public Suffix List; the project's own hostname is the private domain to enter, not `vercel.app`. If Google requests domain ownership verification, follow the actual prompt using an account that owns this Google Cloud project and the deployment. Do not claim verification is complete from a successful Save alone. A deployed page does not itself approve OAuth branding.

After saving Branding, return to Audience → Publish app. If it remains unavailable, inspect the new validation message before changing other settings.

## Data handling before real uploads

Read the public privacy page before connecting the owner's account. Photos pass through Vercel to Drive and Gemini; recognized text is stored in Sheets. Access to those files follows their existing Google sharing settings. Private branch authentication does not make a publicly shared archive private. Review actual Drive and Sheets sharing before uploading confidential records.

Verify the actual Gemini project's billing and applicable data-processing terms before uploading confidential or personal information. Google's unpaid-service terms prohibit those inputs and allow use of inputs/outputs for product improvement with human review; paid-service terms differ. The Cloud console's free-trial banner does not establish the API project's billing mode. The setup script does not activate billing or change these settings. Use synthetic, non-confidential data for acceptance until this is settled.

## Variables added

| Variable | Purpose |
| --- | --- |
| `CASH_PHOTO_DRIVE_CLIENT_ID` | Google Desktop OAuth client ID |
| `CASH_PHOTO_DRIVE_CLIENT_SECRET` | OAuth client credential |
| `CASH_PHOTO_DRIVE_REFRESH_TOKEN` | Offline Drive access; saved in the private setup output and Vercel environment |
| `CASH_PHOTO_DRIVE_FOLDER_ID` | The new app-owned upload folder |
| `CASH_PHOTO_ACCESS_JSON` | Array of `{accessId,branch,label,active,tokenSha256}` entries |

Missing/partial OAuth config disables uploads. Missing/invalid/ambiguous branch registry denies every branch request. There is no fallback to public sheet tokens or service-account file creation.

## Production acceptance after owner consent

- `/api/health` remains 200. Cash-photo probe returns 503 until OAuth **and** branch access are configured; metadata-only Drive readability is not upload readiness.
- Probe returns `uploadStorage.ok:true`, `accessConfigured:true`, and Gemini availability. It never returns secrets.
- Open one private branch link and upload a clearly marked synthetic image containing no transactions. Confirm a new user-owned Drive file, exactly one archive row, and the recognition result through Sheets readback. Repeat the same bytes once to confirm idempotency.
- Verify legacy photo `PHOTO-20260910-134422-315df084` retains the same file/hash and 11-operation recognized result. Do not re-recognize it.
- Verify no cash-photo writes to DDS or financial registers; distinguish concurrent bank imports from this workflow. Remove only the identified synthetic test artifact after verification.
- Public legacy recovery/OAuth GET routes remain 405; requests without a valid private branch token remain 403.

## Sources checked 2026-09-11

- [Drive error: service accounts have no storage quota](https://developers.google.com/workspace/drive/api/guides/handle-errors#storageQuotaExceeded)
- [Drive per-file scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Desktop OAuth, PKCE and loopback redirect](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Refresh-token lifetime and Testing status](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Google brand verification: homepage, privacy, optional terms and domain ownership](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Public Suffix List, including vercel.app](https://publicsuffix.org/list/public_suffix_list.dat)
- [Gemini API data handling for paid and unpaid services](https://ai.google.dev/gemini-api/terms)
