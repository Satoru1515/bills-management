# Deploying (Vercel + Supabase)

Step-by-step guide to put the app online for personal use: the database and sign-in on a hosted **Supabase** project, the Next.js app and its scheduled sync on **Vercel**. You do this once; after that every push to `main` deploys by itself.

How the pieces fit together:

```
                 ┌──────────────────────── Vercel ────────────────────────┐
Browser / app ──>│ Next.js app (/app, /login, /auth/callback, /api/sync)  │──> Gmail API (read-only)
                 │ Vercel Cron ──> GET /api/cron/sync (Bearer CRON_SECRET)│
                 └───────────────┬────────────────────────────────────────┘
                                 │ anon key (user's session, RLS)
                                 │ service_role key (sync, server only)
                                 ▼
                 Supabase: Postgres (migrations in supabase/) + Auth (Google provider)
```

Google sign-in itself is configured in [google-cloud-setup.md](google-cloud-setup.md); this guide links to it where it is needed. The Android app only needs the final URL ([android.md](android.md)).

## What you need first

- The code on `main`. Vercel deploys production from `main`, and until the phase PRs are merged `main` only holds the initial commit. Merge the open PRs in order (Fase 0 to Fase 7) first.
- A [Supabase](https://supabase.com/) account (the free plan is enough) and a [Vercel](https://vercel.com/) account signed in with the GitHub account that owns `Satoru1515/bills-management`.
- The Google Cloud project and OAuth client from [google-cloud-setup.md](google-cloud-setup.md) steps 1 to 6 (you can do it in parallel; step 3 below needs the Client ID and secret).
- Node.js 22 and `npm install` done in the repo, to run the Supabase CLI with `npx` (nothing is installed globally).
- A decision on the sync schedule (step 6): the 15-minute cron in `vercel.json` needs Vercel **Pro**. On the free **Hobby** plan that file must be changed **before the first deploy**, or every deployment fails.

## 1. Create the Supabase project

1. <https://supabase.com/dashboard> > **New project**.
2. Name: `bills-management`. **Database password**: generate a strong one and keep it in your password manager (the CLI asks for it in step 2).
3. **Region**: the same area as the Vercel functions, so every request is a short hop. Vercel runs functions in Washington, D.C. (`iad1`) by default, so pick **East US (North Virginia)**. If you choose another region here, change the Vercel function region to match (step 4).
4. Wait until the project is ready, then open **Project Settings > API** (or **API Keys**) and note:
   - **Project URL** (`https://<ref>.supabase.co`) → `NEXT_PUBLIC_SUPABASE_URL`. `<ref>` is the project reference used below.
   - **anon** (public) key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - **service_role** (secret) key → `SUPABASE_SERVICE_ROLE_KEY`. It bypasses RLS: it only ever goes into Vercel's environment variables, never into the browser or the repo.

   Newer projects show _publishable_ (`sb_publishable_…`) and _secret_ (`sb_secret_…`) keys first and keep the old ones under **Legacy API keys**. Either pair works with `supabase-js`; use the same kind for both.

## 2. Apply the database migrations

The tables, Row Level Security and policies are in `supabase/migrations/` (`0001_init.sql`, `0002_rls_policies.sql`, `0003_sync_runs_server_only.sql`). Push them with the Supabase CLI (a dev dependency, run through `npx`):

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <ref>
```

```bash
npx supabase db push
```

`link` asks for the database password from step 1. `db push` lists the migrations it will apply; confirm. Running it again later only applies new migrations.

Check in the dashboard:

- **Table Editor**: `profiles`, `gmail_connections`, `transactions`, `category_rules` and `sync_runs` exist.
- **Authentication > Policies** (or **Database > Policies**): every one of those tables shows **RLS enabled** with its policies.
- Optional but recommended: the manual RLS test in [rls.md](rls.md#prueba-manual-supabase-real), with two throwaway users you delete afterwards.

Optional: regenerate the TypeScript types from the hosted database (instead of the local stack that `npm run db:types` uses) and commit the result if it changed:

```bash
npx supabase gen types typescript --linked --schema public > src/lib/supabase/database.types.ts
```

```bash
npx prettier --write src/lib/supabase/database.types.ts
```

## 3. Configure Supabase Auth

1. **Authentication > Providers > Google**: enable it with the Client ID and Client secret from Google Cloud ([google-cloud-setup.md](google-cloud-setup.md#7-put-the-credentials-in-supabase-and-the-app), "Hosted Supabase project"). Copy the **Callback URL** shown there (`https://<ref>.supabase.co/auth/v1/callback`) into the Google client's **Authorized redirect URIs** if it is not there yet.
2. **Authentication > URL Configuration**. You only know the production URL after step 4; until then put the Vercel URL you plan to use (the project name decides it, e.g. `https://bills-management-<you>.vercel.app`) and correct it later if needed.
   - **Site URL**: `https://<your domain>`.
   - **Redirect URLs**:
     - `https://<your domain>/auth/callback`
     - `http://localhost:3000/auth/callback` (keep local development working against this project, if you use it that way)
     - `com.satoru1515.bills://auth/callback` (Google sign-in in the Android app)
3. **Authentication > Providers > Email**: turn it **off**. The app only signs in with Google, and leaving email sign-up on lets anyone with the public anon key create an account in your project.

## 4. Create the Vercel project

1. <https://vercel.com/new> > **Import Git Repository** > `Satoru1515/bills-management` (grant Vercel access to that repository if GitHub asks).
2. **Framework Preset**: Next.js (detected). Root directory, build command (`next build`) and output: leave the defaults.
3. **Environment Variables**: add them now (table in step 5) so the first build already has them. You can also add them later and redeploy.
4. **Deploy**. When it finishes, the production URL is on the project page (**Domains**), e.g. `https://bills-management-<you>.vercel.app`.
5. **Settings > Build and Deployment > Node.js Version**: **22.x** (the version the project is developed and tested on).
6. **Settings > Functions > Function Region**: the region closest to the Supabase project (Washington, D.C. `iad1` for East US). Changing it takes effect on the next deployment.
7. **Settings > Git**: the production branch is `main`. Other branches and pull requests get preview deployments (see [Preview deployments](#preview-deployments)).

## 5. Environment variables

**Settings > Environment Variables**, scope **Production** (add **Preview** too only if you want working previews). Mark the secret ones as **Sensitive** so their values cannot be read back from the dashboard. Every variable is described in [`.env.example`](../.env.example).

| Variable | Value | Secret |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (step 1) | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key (step 1) | no (public by design; RLS protects the data) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key (step 1) | **yes** |
| `GOOGLE_CLIENT_ID` | OAuth client ID (Google Cloud) | no |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret (Google Cloud) | **yes** |
| `ENCRYPTION_KEY` | New 32 random bytes, base64 (command below) | **yes** |
| `CRON_SECRET` | New random hex string (command below) | **yes** |
| `NEXT_PUBLIC_APP_URL` | `https://<your domain>`, no trailing slash | no |

Generate the two secrets on your computer, one command each, and paste the output straight into Vercel (do not save them in any file in the repo):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The first is `ENCRYPTION_KEY`, the second `CRON_SECRET`.

Things to know:

- **`NEXT_PUBLIC_*` values are built into the browser code.** After changing one, redeploy (**Deployments > ⋯ > Redeploy**) or the old value stays in use. The other variables apply to the next deployment as well.
- **`ENCRYPTION_KEY` must not change** once users have connected Gmail: the stored refresh tokens can only be decrypted with the key that encrypted them. If it is lost or changed, every user has to sign in again (Settings > Reconnect Gmail) to store a new token. Use a different key from your local `.env.local`.
- `CRON_SECRET` can be changed at any time (update the external scheduler too if you use one, step 6).
- `CAP_SERVER_URL` is only for building the Android app on your computer; it does not go into Vercel.

You can also set them from the terminal with the Vercel CLI, without installing it globally: `npx vercel link`, then `npx vercel env add <NAME> production` for each one (it prompts for the value, so it does not end up in your shell history).

## 6. Scheduled sync (cron)

`vercel.json` asks Vercel Cron to call `GET /api/cron/sync` every 15 minutes. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically; the endpoint refuses any other caller (`401`) and refuses to run without `CRON_SECRET` (`500 cron_not_configured`). Each call syncs every user with Gmail connected, one after another, within the function's 60-second limit (`maxDuration` in `src/app/api/cron/sync/route.ts`), which is plenty for a few users. Users can always sync on demand with **Sync now** on `/app`.

Vercel Cron only runs on the production deployment, and what it may run depends on the plan. Pick one option **before the first deploy**:

| Option | Plan | Schedule | What to do |
| --- | --- | --- | --- |
| A. Vercel Cron every 15 min | Pro | `*/15 * * * *` | Nothing: `vercel.json` already says so. |
| B. Vercel Cron once a day | Hobby (free) | daily, ±59 min | Change the schedule in `vercel.json` (below). |
| C. External scheduler | Hobby (free) | every 15-30 min | Remove the cron from `vercel.json` and call the endpoint from another service (below). |

On Hobby, a schedule that runs more than once a day makes **every deployment fail** with `Hobby accounts are limited to daily cron jobs` (sometimes without a clear message in the dashboard; `npx vercel build` shows it). Options B and C avoid it.

**Option B**: in `vercel.json`, change the schedule to a daily one. Cron times are UTC; `0 11 * * *` is 7:00 AM in the Dominican Republic (UTC-4), and Hobby may run it any time within that hour:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cron/sync", "schedule": "0 11 * * *" }]
}
```

**Option C**: make `vercel.json` hold only `{ "$schema": "https://openapi.vercel.sh/vercel.json" }` (no `crons`) and have a scheduler send this request every 15 to 30 minutes:

```
GET https://<your domain>/api/cron/sync
Authorization: Bearer <CRON_SECRET>
```

- A free web cron service (for example [cron-job.org](https://cron-job.org/)) can do it: URL as above, method GET, a custom `Authorization` header, every 15 minutes. The secret then lives in that service, so use one you trust and turn on its failure notifications.
- GitHub Actions also works (repository **Settings > Secrets and variables > Actions**: secrets `APP_URL` and `CRON_SECRET`), but scheduled workflows can start several minutes late, and in a private repository each run counts as at least one billed minute: every 15 minutes is about 2,900 minutes a month, more than the 2,000 free ones, so use every 30 minutes. A minimal `.github/workflows/sync.yml`:

  ```yaml
  name: Gmail sync
  on:
    schedule:
      - cron: "*/30 * * * *"
    workflow_dispatch:
  jobs:
    sync:
      runs-on: ubuntu-latest
      timeout-minutes: 2
      steps:
        - run: >
            curl --fail-with-body --silent --show-error --max-time 90
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
            "${{ secrets.APP_URL }}/api/cron/sync"
  ```

**Check it** (any option) from a terminal, with the secret in the `CRON_SECRET` environment variable:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<your domain>/api/cron/sync
```

A `200` with totals (`users`, `ok`, `failed`, `skipped`, `reconnectRequired`, `newTransactions`) means it works; it never returns user data. Without the header it must answer `401`. With Vercel Cron, **Settings > Cron Jobs** lists the job, has a **Run** button, and links to its logs.

Remember the Google side: while the Google app is in **Testing** mode, refresh tokens expire after 7 days, so the background sync starts failing with `reconnectRequired` about a week after each sign-in ([google-cloud-setup.md](google-cloud-setup.md#5-testing-mode-and-test-users)). Settings shows it and has the **Reconnect Gmail** button.

## 7. Custom domain (optional)

The `*.vercel.app` address works as is. To use your own domain:

1. Vercel **Settings > Domains > Add**, type the domain (e.g. `bills.example.com`) and add the DNS records Vercel shows at your DNS provider. Vercel issues the HTTPS certificate by itself once DNS resolves.
2. Then update every place that holds the app's URL:
   - Vercel: `NEXT_PUBLIC_APP_URL`, then **Redeploy**.
   - Supabase **Authentication > URL Configuration**: **Site URL** and the `https://<domain>/auth/callback` **Redirect URL** (keep the old one until the new one works).
   - Google Cloud OAuth client: **Authorized JavaScript origins** gets `https://<domain>` ([google-cloud-setup.md](google-cloud-setup.md#6-oauth-client-clients--credentials) step 6.3). The redirect URI stays the Supabase one.
   - Google consent screen **Authorized domains**, only if you filled in a home page or privacy link.
   - Android app: `CAP_SERVER_URL=https://<domain> npm run android:sync` and build a new APK ([android.md](android.md#1-point-the-app-at-the-deployed-site)).
   - The external scheduler, if you chose option C.
3. Optional: in **Settings > Domains**, redirect the `*.vercel.app` address to the new domain so there is a single URL (sessions are per domain).

## 8. First run checklist

Go through the deploy-time items (🔧) of the [security checklist](security.md) as well.


1. Open `https://<your domain>/app`: you are sent to `/login`.
2. **Continue with Google** with an account on the Google test user list. Allow Gmail access on the consent screen.
3. You land on `/app`. Press **Sync now**: the first sync reads about six months of bank alerts. To go further back, use **Import history** below it.
4. **Settings** (`/app/settings`): Gmail shows **Connected** with the last sync time. Set the USD → DOP rate (the app uses 63 until you do).
5. Supabase **Table Editor**: `gmail_connections` has your row with `refresh_token_encrypted` starting with `v1.`, `transactions` has rows, and `sync_runs` has an `ok` run.
6. After the next scheduled time (step 6), `sync_runs` gets a row with trigger `cron`.
7. Install the PWA from the browser (Chrome: **Install app**) and check **DevTools > Application > Manifest / Service workers** show no errors.
8. On Android: build the APK against the production URL ([android.md](android.md)) and sign in once in the app.

## Updating

- Push or merge to `main` → Vercel builds and deploys production. A failed build keeps the previous deployment online.
- A change that adds a migration: run `npx supabase db push` **before** merging the code that needs it, so the new code never meets the old schema.
- Rolling back: **Deployments**, pick an older one > **Promote to Production** (`⋯` menu). Migrations are not rolled back by this.
- New Supabase or Google secrets: update them in Vercel and redeploy. Remember `ENCRYPTION_KEY` must stay the same (step 5).

### Preview deployments

Every pull request gets its own URL. Previews only work fully if the variables are also set for **Preview** and their URL is allowed in Supabase's Redirect URLs (a pattern such as `https://bills-management-*-<your-team>.vercel.app/**` covers them). They use the same database as production unless you create a second Supabase project, so for a personal app it is simpler to leave previews without variables and test locally. Vercel Cron never calls previews.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Every deployment fails, or none appears after a push | On Hobby, a cron in `vercel.json` that runs more than once a day. Use option B or C in step 6. `npx vercel build` shows the error. |
| Build or page error `Missing environment variable …` | That variable is not set for the environment being built. Add it in step 5 and redeploy. |
| After sign-in you end up on the Site URL (or the home page) instead of `/app` | `https://<domain>/auth/callback` is missing from Supabase's Redirect URLs (step 3). |
| `Error 400: redirect_uri_mismatch` on Google's page | The Supabase callback is missing from the Google client's redirect URIs ([google-cloud-setup.md](google-cloud-setup.md#troubleshooting)). |
| `/login?error=gmail_token_failed` | `SUPABASE_SERVICE_ROLE_KEY` or `ENCRYPTION_KEY` is wrong or missing in Vercel. |
| Sync fails for every user after changing `ENCRYPTION_KEY` | The stored tokens were encrypted with the old key. Put the old key back, or have each user reconnect Gmail. |
| `GET /api/cron/sync` answers `500 cron_not_configured` | `CRON_SECRET` is not set in Production. Add it and redeploy. |
| `GET /api/cron/sync` answers `401` | The `Authorization` header does not match `Bearer <CRON_SECRET>` exactly (check for spaces or an old secret in the scheduler). |
| Cron runs but `reconnectRequired` keeps growing | Google Testing mode: tokens expire after 7 days. Reconnect in Settings, or publish the Google app ([google-cloud-setup.md](google-cloud-setup.md#5-testing-mode-and-test-users)). |
| The Android app opens the old URL | Run `npm run android:sync` with the new `CAP_SERVER_URL` and rebuild the APK. |
