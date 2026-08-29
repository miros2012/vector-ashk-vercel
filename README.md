# Vector AШК backend — Vercel pilot

Safe pilot for AШК payments sync.

- `GET /api/health` — checks presence of secrets.
- `POST /api/sync-payments` — fetches current-month AШК payments and writes ONLY to staging sheet `АШК_Оплаты__vercel`, then compares it with live `АШК_Оплаты`.
- It does not overwrite the live payments sheet.

Required Vercel environment variables:
- `ASHK_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

Google service account must have Editor access to spreadsheet:
`1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10`
