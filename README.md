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

Requirements: Node.js 20 or newer (developed on Node 22) and npm.

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

Before committing, `npm run lint`, `npm run typecheck` and `npm test` must all pass.

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
├── docs/
│   ├── parsing-spec.md     # Email formats per bank and category rules (source of truth for parsers)
│   └── rutina.md           # Prompt of the automated development routine
├── public/                 # Static assets
├── src/
│   ├── app/                # Next.js App Router pages, layouts and API routes
│   └── test/               # Shared test files (smoke test)
├── CLAUDE.md               # Project conventions and rules for the automated routine
├── PLAN.md                 # Phased development plan
├── PROGRESS.md             # Log of completed tasks
├── .env.example            # Environment variable template
├── vitest.config.mts       # Vitest config (jsdom, `@/` alias)
└── vitest.setup.ts         # jest-dom matchers and cleanup
```

Planned as the phases land (see `PLAN.md`):

```
src/lib/domain/     # Types, categorization, deduplication
src/lib/parsers/    # One pure parser per bank, with fixtures in __fixtures__/
src/lib/supabase/   # Browser and server Supabase clients
src/lib/repo/       # Data access (transactions, rules)
src/lib/gmail/      # Gmail API client
src/lib/sync/       # Sync pipeline: fetch, parse, categorize, dedupe, upsert
supabase/           # Supabase CLI config and SQL migrations
android/            # Capacitor Android project
```

## License

Apache-2.0
