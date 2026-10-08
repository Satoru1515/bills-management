# Security checklist

What protects the data before the app goes online, where each item lives in the code, and what still has to be done by hand when deploying ([deploy.md](deploy.md)). Reviewed on 2026-10-08 (Fase 7).

- ✅ done in the code, with the test that keeps it true
- 🔧 to do (or check) when deploying
- ⚠️ known limitation, accepted for a personal app

## 1. Gmail tokens are encrypted

- ✅ The Gmail **refresh token** is encrypted with AES-256-GCM before it is stored (`src/lib/crypto.ts`): format `v1.<iv>.<tag>.<ciphertext>`, a random 12-byte IV per encryption, and the user's id bound as additional authenticated data, so a value copied into another user's row does not decrypt. Tests: `src/lib/crypto.test.ts`, `src/lib/auth/gmail-token.test.ts`.
- ✅ The token is written and read only by server code with the service role (`src/lib/auth/callback-deps.ts`, `src/lib/sync/run.ts`). Signed-in users and `anon` cannot even select the `refresh_token_encrypted` column (column grants in `0002_rls_policies.sql`). Test: `src/test/rls.test.ts`.
- ✅ **Access tokens** live only in memory during a sync and are never stored. Error messages and logs never include tokens (`src/lib/gmail/client.ts`).
- ✅ The app only asks for `gmail.readonly` (`src/lib/auth/google.ts`); it cannot send, change or delete email.
- ✅ Only the last 4 digits of a card are stored; balances and account numbers are never saved (parsers, `docs/parsing-spec.md`).
- 🔧 `ENCRYPTION_KEY` in Vercel is a **new** random 32-byte key (not the one in `.env.local`), marked Sensitive, and kept in a password manager. Changing or losing it means every user has to reconnect Gmail ([deploy.md](deploy.md#5-environment-variables)).

## 2. Row Level Security is on

- ✅ RLS is enabled on all five tables (`profiles`, `gmail_connections`, `transactions`, `category_rules`, `sync_runs`) and every policy is for `authenticated` and limited to the user's own rows; `anon` gets nothing. Tests: `src/test/rls.test.ts` (two users, every table, every operation) and `src/test/migrations.test.ts`. Details in [rls.md](rls.md).
- ✅ `sync_runs` is read-only for users since migration `0003_sync_runs_server_only.sql`: only the server records syncs, so users cannot fake or rewrite the rows that decide whether a sync is running and how often they may sync (section 4).
- ✅ The service role key (which bypasses RLS) is only used by server code (`src/lib/supabase/admin.ts`), and every query made with it filters by `user_id`. No client component imports the admin client, `src/lib/crypto.ts` or any server-only secret. Test: `src/test/secrets.test.ts`.
- ✅ Dashboard edits (category, ignore) go through server actions that validate the id, category and flag and use the user's own client, so RLS applies a second time (`src/lib/dashboard/edit.ts`).
- 🔧 After `npx supabase db push`, check in the dashboard that the five tables show **RLS enabled**, and optionally run the manual test in [rls.md](rls.md#prueba-manual-supabase-real).
- ⚠️ Users can still insert, update or delete their own `gmail_connections` row through the API (for example `last_sync_at`, or the encrypted token column). It only affects their own sync and never anyone else's data. A later migration could make the table read-only for users like `sync_runs`, since the server writes it with the service role.

## 3. Secrets stay out of the repo

- ✅ `.gitignore` excludes `.env` in any folder (so also `supabase/.env`) and `.env*.local` (only `.env.example` is committed), `*.pem`, `*.jks`, `*.keystore`, `.vercel` and the Android release folder.
- ✅ `.env.example` holds placeholders only (`your-…` or empty) for the secret variables. The Android app's URL is written to a git-ignored file at `cap sync` time (`docs/android.md`).
- ✅ `src/test/secrets.test.ts` scans every tracked file on each `npm test` for real-looking Google client secrets, refresh and access tokens, Supabase secret keys, JWTs (Supabase anon and service_role keys) and private keys, and fails if an env file, keystore or certificate is tracked. The tests use short fake tokens that the scan lets through.
- ✅ The whole git history (all branches) was searched with the same patterns on 2026-10-08: no matches, and no env file other than `.env.example` was ever committed.
- 🔧 In Vercel, mark `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET`, `ENCRYPTION_KEY` and `CRON_SECRET` as **Sensitive**. Keep the Android release keystore and its passwords outside the repo ([android.md](android.md#3-build-a-signed-release-apk-optional)).

## 4. `/api/sync` is rate limited

`POST /api/sync` (the **Sync now** button) reads the user's Gmail and holds a function for up to a minute, so it is limited per user (`src/lib/sync/requests.ts`, `src/lib/sync/rate-limit.ts`):

- ✅ Requests from another site are refused (`403`, `Origin` check) before the session is read; signed-out requests get `401`.
- ✅ One sync at a time per user: `409` while a run started in the last 10 minutes is still `running`.
- ✅ **Rate limit**: at most one manual sync per minute and 10 per rolling hour per user. Otherwise `429` with `{ "error": "rate_limited", "retryAfterSeconds": n }` and a `Retry-After` header; the button says how long to wait. The count comes from the user's own `sync_runs` rows (trigger `manual`), so it works across serverless instances without extra storage, and users cannot change those rows (section 2). Tests: `src/lib/sync/rate-limit.test.ts`, `src/lib/sync/requests.test.ts`, `src/lib/sync/feedback.test.ts`.
- ✅ `GET /api/cron/sync` only runs with `Authorization: Bearer <CRON_SECRET>` (compared in constant time), refuses to run when the secret is not set, and returns totals only, never user data.
- ⚠️ Two requests sent at the very same instant can both pass the checks before either run is recorded. Both runs then insert the same Gmail messages, and the unique `gmail_message_id` per user keeps only one copy, so the worst case is one extra sync.
- 🔧 For a public deployment with many users, a limit per IP in front of the app (Vercel Firewall rate limiting) would also cover the sign-in pages; not needed for personal use.

## 5. Sign-in

- ✅ Google sign-in through Supabase with PKCE; the `next` path after sign-in only accepts same-site paths, so it cannot be used as an open redirect (`safeNextPath` in `src/lib/auth/redirect.ts`). The middleware sends signed-out visitors of `/app/*` to `/login`, and pages and actions check the user again on the server.
- ✅ In the Android app, the code that comes back through the deep link is useless without the PKCE verifier kept in the app's WebView ([android.md](android.md#4-google-sign-in-in-the-app)).
- 🔧 Supabase **Authentication > Providers > Email**: turn it off, since the app only uses Google ([deploy.md](deploy.md#3-configure-supabase-auth)).
- 🔧 Supabase **Redirect URLs** list only your own URLs and the app's deep link; Google Cloud keeps the app in **Testing** with only your accounts as test users ([google-cloud-setup.md](google-cloud-setup.md#5-testing-mode-and-test-users)).

## 6. Dependencies and other notes

- ⚠️ `npm audit --omit=dev` (2026-10-08) reports the PostCSS copy bundled inside Next.js 15 (source map and `</style>` advisories). PostCSS only processes the app's own CSS at build time, never user input, so it does not affect the running app. The fix is Next.js 16, a major upgrade left for a separate decision. The other advisories are in development tools only (Vitest, the Supabase CLI, the Capacitor CLI's iOS tooling) and never reach the deployed app.
- ⚠️ No Content-Security-Policy or other security headers are set yet beyond Next.js defaults. A possible later improvement: `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and `Referrer-Policy` in `next.config.ts`.
- 🔧 Review this list again whenever a table, an API route or a new secret is added.
