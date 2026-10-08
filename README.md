# Bills Management

Personal expense tracker that turns the transaction alerts your banks already send to Gmail into a categorized spending dashboard. No manual entry, no bank API: just the notification emails you already receive.

**Status:** early development. The project is built incrementally by an automated routine that follows [`PLAN.md`](PLAN.md); see [`PROGRESS.md`](PROGRESS.md) for the log.

## What it does

- Connects to Gmail with read-only access and reads card-consumption notifications from these senders:
  - Scotiabank — `alertas@scotiabank.com`
  - APAP — `no-reply@apap.com.do`
  - Banco Santa Cruz — `notificaciones@bsc.com.do`
  - PayPal receipts — `service@intl.paypal.com`
- Parses each email into a transaction (date, amount, currency, merchant, last 4 digits of the card), drops duplicate alerts and auto-categorizes it by keyword.
- Shows a monthly dashboard: totals (DOP, USD and USD converted to DOP), spending by category and by bank/card, and a searchable transaction list where categories can be edited and transactions ignored.
- Syncs on demand and every 15 minutes via a cron job.
- Web app, installable as a PWA and packaged for Android with Capacitor.

Only the last 4 digits of a card are stored; balances and full account numbers are never saved. Gmail refresh tokens are encrypted at rest (AES-256-GCM).

## Stack

| Area      | Choice                                                 |
| --------- | ------------------------------------------------------ |
| Framework | Next.js 15 (App Router, `src/` dir), React 19          |
| Language  | TypeScript (strict)                                    |
| Styling   | Tailwind CSS 4                                         |
| Backend   | Supabase: Postgres, Auth (Google), Row Level Security  |
| Email     | Gmail API (`gmail.readonly` scope)                     |
| Tests     | Vitest + Testing Library (jsdom)                       |
| Quality   | ESLint + Prettier                                      |
| Mobile    | PWA + Capacitor (Android first)                        |
| Hosting   | Vercel (app + cron) and Supabase                       |

## Running locally

Requirements: Node.js 20 or newer (developed on Node 22; the Capacitor CLI for the Android app needs 22) and npm.

```bash
git clone https://github.com/Satoru1515/bills-management.git
cd bills-management
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run dev                  # http://localhost:3000
```

### Scripts

| Command                | What it does                               |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Start the dev server on port 3000          |
| `npm run build`        | Production build                           |
| `npm start`            | Serve the production build                 |
| `npm run lint`         | ESLint                                     |
| `npm run typecheck`    | TypeScript check (`tsc --noEmit`)          |
| `npm test`             | Run the Vitest suite once                  |
| `npm run test:watch`   | Vitest in watch mode                       |
| `npm run format`       | Format the code with Prettier              |
| `npm run format:check` | Check formatting without writing           |
| `npm run db:types`     | Regenerate `src/lib/supabase/database.types.ts` from the local Supabase database |
| `npm run icons`        | Redraw the app icons, favicon and Android launcher icons and splash screens (`src/lib/pwa/icon-image.ts`) |
| `npm run android:sync` | Copy the Capacitor config (with `CAP_SERVER_URL`) into `android/` |
| `npm run android:open` | Open the Android project in Android Studio |

Before committing, `npm run lint`, `npm run typecheck` and `npm test` must all pass.

### Supabase clients and database types

- `src/lib/supabase/client.ts`: browser client for Client Components (anon key, user session, RLS applies).
- `src/lib/supabase/server.ts`: server client for Server Components, Server Actions and Route Handlers (anon key + session cookies, RLS applies). Create one per request.
- `src/lib/supabase/admin.ts`: service-role client (bypasses RLS). Server-only, for the cron sync and Gmail tokens; always filter by `user_id`.

`npm run db:types` needs the local stack running (`npx supabase start`, which requires Docker). Without Docker, use `npx supabase gen types typescript --project-id <ref> --schema public` against the hosted project. After changing a migration, regenerate the types: `src/lib/supabase/database.types.test.ts` compares them with the schema the migrations build and fails if they drift.

### Google sign-in and the Gmail token

Users sign in with Google through Supabase Auth (`src/lib/auth/google.ts`). The app asks for the read-only Gmail scope (`https://www.googleapis.com/auth/gmail.readonly`) with `access_type=offline` and `prompt=consent`, so Google returns a refresh token on every sign-in. Supabase hands that token over only once, on the session returned by `exchangeCodeForSession` in the auth callback; `storeGmailTokenFromSession` (`src/lib/auth/gmail-token.ts`) encrypts it and saves it in `gmail_connections`.

- `src/lib/crypto.ts`: AES-256-GCM with `ENCRYPTION_KEY`. Payloads look like `v1.<iv>.<tag>.<ciphertext>` (base64url), and the user id is bound as additional authenticated data, so a token copied to another user's row does not decrypt. Changing `ENCRYPTION_KEY` makes every stored token unreadable: users then have to sign in again.
- `src/lib/repo/gmail-connections.ts`: `saveGmailConnection` and `getRefreshToken`, used with the service-role client only.

Routes and session handling:

- `/login`: "Continue with Google" button (a Server Action that starts the OAuth flow with `/auth/callback` on the same origin as `redirectTo`). Signed-in users are sent on to `/app`, unless the URL carries an `?error=` to show.
- `/auth/callback`: exchanges the `?code=` for a session (PKCE cookies), stores the Gmail token and redirects to `?next=` (local paths only) or `/app`; failures go back to `/login?error=<code>` (see `LOGIN_ERRORS` in `src/lib/auth/redirect.ts`).
- `/app/*`: requires a session. `src/middleware.ts` refreshes the Supabase cookies on every request (`src/lib/supabase/middleware.ts`) and redirects signed-out visitors to `/login?next=<page>`.
- `/` redirects to `/app`.

To create the Google OAuth client (consent screen in Testing mode, test users, redirect URIs), follow [`docs/google-cloud-setup.md`](docs/google-cloud-setup.md).

Add `<app url>/auth/callback` to the Supabase redirect allow-list (Authentication > URL Configuration) for every origin the app runs on.

For the local stack, `supabase/config.toml` enables the Google provider with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` taken from the environment (export them, or put them in `supabase/.env`, which is git-ignored). On the hosted project, enable Google under Authentication > Providers with the same credentials.

### Reading Gmail

`src/lib/gmail/client.ts` is a small read-only Gmail API client over `fetch` (server-only, no extra dependencies). `createGmailClient({ credentials: googleOAuthCredentials(), refreshToken })` gets access tokens from the stored refresh token (cached until a minute before they expire, refreshed and retried once on a 401) and offers:

- `listMessages(query, after?)`: ids of every message matching a Gmail search, all pages (capped at 2000). `after` adds `after:YYYY/MM/DD` in Dominican Republic time.
- `getMessage(id)`: the message as a `RawEmail`. The body is the `text/plain` part, or the HTML converted to text (`src/lib/gmail/mime.ts`: table cells joined with ` | `, entities and charsets decoded, attached files skipped). Large bodies stored as attachments are fetched too.

Failures throw `GmailError`; `reconnectRequired` is true when the refresh token was revoked or expired (`invalid_grant`) or the Gmail scope is missing, so the user has to sign in again.

### Syncing

`runSync(createSyncDeps(createAdminClient()), userId, "manual" | "cron")` (`src/lib/sync/run.ts`) syncs one user:

1. Creates a `running` row in `sync_runs`.
2. Searches each known sender (`SENDER_QUERIES`; PayPal only `subject:receipt`) from a day before `last_sync_at`, or about six months (183 days) back on the first sync. **Import history** on `/app` posts `{ "since": "YYYY-MM-DD" }` to search from that day instead (up to two years back).
3. Skips messages already stored, except Scotiabank ones, which are read again so a later alert for a saved purchase is recognized as a repeat.
4. Parses, collapses repeated Scotiabank alerts (keeping the stored one if any), categorizes with the user's `category_rules` first, and inserts the new purchases (existing rows are never touched, so edited categories and `ignored` survive).
5. Completes the `sync_runs` row (`ok` or `error`, counts, up to 50 errors) and moves `last_sync_at` to the run's start only if nothing failed.

Expected failures are returned, not thrown; `reconnectRequired` tells the UI to ask for a new Google sign-in.

Two endpoints start a sync (`src/lib/sync/requests.ts`, wired in `src/app/api`):

- `POST /api/sync`: the **Sync now** button on `/app`. Needs the user's session and a same-site `Origin`; answers `401` when signed out, `409` while another sync of the user is running (a `running` row younger than 10 minutes), `429` with `Retry-After` when the user already synced in the last minute or 10 times in the last hour (`src/lib/sync/rate-limit.ts`, counted from `sync_runs`, which users can read but not write), and otherwise `200` with the counts (`newTransactions`, `unparsed`, `errorCount`, `reconnectRequired`, …; error details stay in `sync_runs`).
- `GET /api/cron/sync`: Vercel Cron (`vercel.json`, every 15 minutes) with `Authorization: Bearer $CRON_SECRET`. Syncs every user with a `gmail_connections` row, one after another, and returns totals only. Without `CRON_SECRET` it refuses to run (`500`).

Vercel's Hobby plan only allows daily cron jobs (a more frequent schedule makes every deployment fail), so the 15-minute schedule needs a Pro plan; on Hobby, use a daily schedule or an external scheduler calling the endpoint with the same header ([`docs/deploy.md`](docs/deploy.md#6-scheduled-sync-cron)).

### Exchange rate

Settings has the USD → DOP rate used for every total. **Get rate** looks up the rate published on a chosen day (`lookupRate` in `src/lib/rates/usd-dop.ts`) from the free [currency API by Fawaz Ahmed](https://github.com/fawazahmed0/exchange-api) (daily rates since March 2024, no key; jsDelivr first, Cloudflare Pages mirror as fallback, and the latest file when today's is not out yet) and fills the box; **Save** stores it. The lookup runs in a server action for signed-in users only and saves nothing by itself.

### Dashboard

`/app?month=YYYY-MM` shows one month (the current one, in Dominican Republic time, when `month` is missing, malformed or in the future); `/app?from=YYYY-MM-DD&to=YYYY-MM-DD` shows a custom range of days instead (its end capped at today, at most about five years; see `resolvePeriod` in `src/lib/domain/period.ts`). Below the title, quick ranges (**This month**, **Last 3 months**, **Last 6 months**, **This year**) and a From / To form switch between them. `loadDashboard` (`src/lib/dashboard/load.ts`) reads, in one query, the period, the previous period (the month before, or as many days right before a range) and the months of the trend, plus the user's USD → DOP rate, with the user's own client (RLS applies); `summarizePeriod` (`src/lib/domain/summary.ts`) computes the KPI cards, leaving out ignored transactions:

- **Total**: pesos plus dollars converted at `profiles.usd_to_dop_rate`, or `DEFAULT_USD_TO_DOP_RATE` (`src/lib/domain/money.ts`) when the user has not set one.
- **In pesos** / **In dollars**: what was spent in each currency, unconverted.
- **Daily average**: the total over the days elapsed (all of them for a past period, up to today for the current one).
- **vs previous month** (or **vs previous period**): change of the total against the whole previous period, in red with ▲ when spending went up and in green with ▼ when it went down (`changeTone` in `src/lib/domain/money.ts`, `ChangeBadge` in `src/app/app/change-badge.tsx`).

Below the cards, `src/lib/domain/breakdown.ts` splits the month by category (one bar each, largest first, with its share of the total) and by bank and card (last 4 digits). Each category also shows its change against the previous period, with the same colors (`new` when it had no spending before). Clicking a category bar adds `?category=<name>` and limits the bank and card summary to that category; clicking it again (or **Show all categories**) clears it, and the month selector keeps it. The KPI cards always cover the whole period.

**Month by month** lists the spending of each month (at least the last six up to the period's end, up to 24 for a long range; `trendMonths` and `monthlyTrend`) with its change against the month before, colored the same way; each month links to its own dashboard.

Sums are done in cents so they do not drift. The header has a month selector (previous / next and a month input). Colors are CSS variables in `src/app/globals.css` (`background`, `surface`, `muted`, `border`, `accent`, `accent-soft`, available as Tailwind colors), with a light and a dark set that follow the system theme; amounts use tabular numbers.

### Installing the app (PWA)

The app is installable from the browser (Chrome/Edge: **Install app** in the address bar or menu; Android Chrome: **Add to Home screen**; iOS Safari: **Share → Add to Home Screen**). Installing needs HTTPS (or `localhost`) and a production build: the service worker is not registered under `npm run dev`, so it never serves stale scripts while developing.

- **Manifest**: `src/app/manifest.ts` serves `/manifest.webmanifest` (name, `start_url` `/app`, standalone display, colors, icons) from `webAppManifest()` in `src/lib/pwa/manifest.ts`. The root layout adds the light and dark `theme-color` and the Apple web app tags.
- **Icons**: a white card on the accent blue, drawn in code by `src/lib/pwa/icon-image.ts` (no image tools needed). `npm run icons` writes `public/icons/icon-192.png`, `icon-512.png`, `maskable-512.png` (edge to edge, card inside the safe zone), `src/app/apple-icon.png` and `src/app/favicon.ico`; a test fails if the committed files no longer match the drawing.
- **Service worker**: `public/sw.js`, registered by `src/app/service-worker.tsx` (`src/lib/pwa/register.ts`). Build assets under `/_next/static` are cached on first use (newest 200 kept); icons and the manifest are served from the cache and refreshed in the background; page navigations always go to the network and fall back to `public/offline.html` when it is unreachable. Pages, API routes, auth and server actions are never cached, since they hold private data. Bump `VERSION` in `sw.js` when its caching changes; old caches are deleted on activation. `next.config.ts` serves `sw.js` with `Cache-Control: no-cache`, and the middleware skips the PWA files.

### Android app

`android/` is a [Capacitor](https://capacitorjs.com/) project whose WebView opens the deployed site (`CAP_SERVER_URL`, read by `capacitor.config.ts` at `npm run android:sync`), so the app runs the same code as the website. Building the APK, signing a release and the app ID are covered in [`docs/android.md`](docs/android.md). Google sign-in inside the app opens in the system browser and comes back through the deep link `com.satoru1515.bills://auth/callback`, which must be added to Supabase's Redirect URLs ([details](docs/android.md#4-google-sign-in-in-the-app)).

## Deploying

The app runs on Vercel with a hosted Supabase project. [`docs/deploy.md`](docs/deploy.md) covers it step by step: creating the Supabase project and applying the migrations, Google sign-in settings, the Vercel project and its environment variables, the scheduled sync (and the Hobby plan limit), a custom domain, a first-run checklist and troubleshooting. Before going live, also go through [`docs/security.md`](docs/security.md) (encrypted tokens, RLS, secrets, the `/api/sync` rate limit).

## Environment variables

All variables are listed with comments in [`.env.example`](.env.example). Copy it to `.env.local` (git-ignored) and fill it in. Never commit real secrets.

| Variable                        | Used for                                                                  |
| ------------------------------- | ------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL                                                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public (anon) key, used by the browser and server clients        |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server-only key that bypasses RLS; used by the cron sync                  |
| `GOOGLE_CLIENT_ID`              | Google OAuth client ID (Gmail read-only access)                           |
| `GOOGLE_CLIENT_SECRET`          | Google OAuth client secret                                                |
| `ENCRYPTION_KEY`                | 32 random bytes, base64-encoded; encrypts Gmail refresh tokens            |
| `CRON_SECRET`                   | Shared secret that protects `GET /api/cron/sync`                          |
| `NEXT_PUBLIC_APP_URL`           | Public base URL, used for OAuth redirects and the mobile app              |

Generate the two secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The first one is for `ENCRYPTION_KEY`, the second for `CRON_SECRET`.

## Project structure

```
.
├── android/                # Capacitor Android project (see docs/android.md)
├── docs/
│   ├── android.md          # Building the Android app (APK) with Capacitor
│   ├── deploy.md           # Deploying to Vercel + Supabase (env vars, cron, domain)
│   ├── google-cloud-setup.md # Google Cloud project, OAuth consent screen and client for sign-in + Gmail
│   ├── parsing-spec.md     # Email formats per bank and category rules (source of truth for parsers)
│   ├── rls.md              # Row Level Security: who can do what, automatic and manual checks
│   ├── security.md         # Security checklist (tokens, RLS, secrets, rate limit)
│   └── rutina.md           # Prompt of the automated development routine
├── mobile/www/             # Page the Android app shows when built without CAP_SERVER_URL
├── public/                 # Static assets: icons/, sw.js (service worker), offline.html
├── scripts/                # generate-icons.mjs (`npm run icons`)
├── src/
│   ├── app/                # Next.js App Router pages, layouts and API routes
│   ├── lib/auth/           # Google sign-in options and Gmail refresh token storage
│   ├── lib/crypto.ts       # AES-256-GCM encryption for stored secrets
│   ├── lib/dashboard/      # Data for the /app dashboard
│   ├── lib/domain/         # Types, categorization, deduplication, months, money, monthly summary
│   ├── lib/gmail/          # Read-only Gmail API client and MIME-to-text conversion
│   ├── lib/parsers/        # One pure parser per bank, with fixtures in __fixtures__/
│   ├── lib/pwa/            # Web app manifest, icon drawing (PNG/ICO encoder), service worker registration
│   ├── lib/repo/           # Data access (transactions, profiles, Gmail connections, category rules, sync runs)
│   ├── lib/supabase/       # Browser, server and service-role clients + generated database types
│   ├── lib/sync/           # Sync pipeline + the manual and cron sync request handlers
│   └── test/               # Shared test files (smoke test, Capacitor config)
├── supabase/               # Supabase CLI config and SQL migrations
├── CLAUDE.md               # Project conventions and rules for the automated routine
├── PLAN.md                 # Phased development plan
├── PROGRESS.md             # Log of completed tasks
├── .env.example            # Environment variable template
├── capacitor.config.ts     # Capacitor config (app ID, URL the Android app opens)
├── vercel.json             # Vercel Cron schedule for /api/cron/sync
├── vitest.config.mts       # Vitest config (jsdom, `@/` alias)
└── vitest.setup.ts         # jest-dom matchers and cleanup
```

## License

Apache-2.0
