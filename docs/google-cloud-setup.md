# Google Cloud setup (OAuth + Gmail read-only)

Step-by-step guide to create the Google Cloud project that lets users sign in with Google and lets the app read their bank notification emails. You do this once; the result is the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` used by Supabase Auth.

How the pieces fit together:

```
Browser ──> /login (app) ──> Supabase Auth ──> Google consent screen
                                   ▲                    │
                                   └── <supabase>/auth/v1/callback
                                              │
                         <app>/auth/callback ◄┘  (stores the encrypted Gmail refresh token)
```

Google only ever redirects to **Supabase** (`/auth/v1/callback`), never directly to the app. Supabase then redirects to the app's `/auth/callback`, which must be in Supabase's redirect allow-list (see step 7).

The Google Cloud console has been renamed a few times: the consent screen now lives under **Google Auth Platform** (sections *Branding*, *Audience*, *Data Access*, *Clients*). Older guides call it **APIs & Services > OAuth consent screen** and **Credentials**. Both names are given below.

## What you need first

- A Google account to own the project (it can be the same Gmail account whose emails the app reads).
- The Supabase project reference (`<ref>` in `https://<ref>.supabase.co`, from Project Settings > API), if you already created the hosted project. For local development only, you can skip it for now.
- The URL(s) where the app will run: `http://localhost:3000` locally, and later the production URL (for example `https://bills-yourname.vercel.app`).

## 1. Create the project

1. Open <https://console.cloud.google.com/> and accept the terms if asked.
2. Project picker (top bar) > **New project**.
3. Name: `Bills Management` (any name works; users only see the app name from step 3). Organization: *No organization*. **Create**.
4. Make sure the new project is selected in the top bar before continuing.

## 2. Enable the Gmail API

1. **APIs & Services > Library**.
2. Search for **Gmail API** > **Enable**.

Without this, sign-in works but every Gmail call in the sync (Fase 4) fails with `403 accessNotConfigured`.

## 3. Consent screen (Branding + Audience)

1. **Google Auth Platform > Branding** (or **APIs & Services > OAuth consent screen**). If it says the platform is not configured yet, click **Get started**.
2. App information:
   - **App name**: `Bills Management` (shown on the consent screen).
   - **User support email**: your email.
3. **Audience**: **External**. (*Internal* only exists for Google Workspace organizations and would block a personal Gmail account.)
4. **Contact information**: your email. Agree to the Google API Services User Data Policy and **Create**.
5. Optional, under **Branding**: app logo, home page and privacy policy links. Leave them empty while the app is in Testing: a logo triggers Google's brand verification.
6. **Authorized domains**: leave empty for local use. When you deploy, add the app's domain and `supabase.co` only if Google asks for them (it does once you fill the home page or privacy links).

## 4. Scopes (Data Access)

1. **Google Auth Platform > Data Access** (or the **Scopes** step of the old consent screen wizard) > **Add or remove scopes**.
2. Select:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `https://www.googleapis.com/auth/gmail.readonly` (filter by "gmail"; it appears under *Gmail API*, which is why step 2 comes first)
3. **Update** > **Save**.

`gmail.readonly` is a **restricted** scope. That is fine in Testing mode (step 5); it only matters if the app is ever published for people outside the test user list. The app never asks for write access: see `GMAIL_READONLY_SCOPE` in `src/lib/auth/google.ts`.

## 5. Testing mode and test users

1. **Google Auth Platform > Audience** (or the **Test users** step of the old wizard).
2. **Publishing status** must say **Testing**. Do not click *Publish app*.
3. **Test users > Add users**: add every Gmail address that will sign in (yours first). Up to 100 addresses. Anyone not on this list is stopped on Google's page with `Error 403: access_denied`.

What Testing mode means in practice:

- Users see a "Google hasn't verified this app" warning on sign-in. Click **Continue**: it is your own app.
- **Refresh tokens expire after 7 days** in Testing mode when a non-basic scope such as `gmail.readonly` is requested. After that, background sync fails with `invalid_grant` and the user has to sign in again (the Settings page of Fase 5 will show the connection status and a reconnect button).
- Publishing the app (*In production*) removes the 7-day expiry, but because `gmail.readonly` is restricted, Google then requires verification for public use. For a personal app with a few known users, staying in Testing and signing in again weekly is the simplest option. Decide this before relying on the cron sync.

## 6. OAuth client (Clients / Credentials)

1. **Google Auth Platform > Clients > Create client** (or **APIs & Services > Credentials > Create credentials > OAuth client ID**).
2. **Application type**: **Web application**. Name: `Bills Management (Supabase)`.
3. **Authorized JavaScript origins** (where the sign-in starts):
   - `http://localhost:3000`
   - `http://127.0.0.1:3000` (only if you open the app on that host)
   - Your production URL, e.g. `https://bills-yourname.vercel.app` (add it when you deploy)
4. **Authorized redirect URIs** (where Google sends the user back; these point to Supabase, not to the app):
   - Hosted Supabase: `https://<ref>.supabase.co/auth/v1/callback`. Supabase shows this exact URL under **Authentication > Providers > Google** as *Callback URL (for OAuth)*; copy it from there.
   - Local Supabase stack (`npx supabase start`): `http://127.0.0.1:54321/auth/v1/callback` (port from `[api]` in `supabase/config.toml`).
   - If you later use a custom domain for Supabase, add its `/auth/v1/callback` too.
5. **Create**. Copy the **Client ID** and **Client secret** right away (newer consoles only show the secret once; if you lose it, add a new secret on the client and delete the old one).

URIs must match exactly: scheme, host, port and path, with no trailing slash. A mismatch shows `Error 400: redirect_uri_mismatch` on Google's page; the error details include the URI that was sent, so add exactly that one.

## 7. Put the credentials in Supabase and the app

Never commit the secret. `.env.local` and `supabase/.env` are git-ignored.

**Hosted Supabase project**

1. **Authentication > Providers > Google**: enable it, paste the Client ID and Client secret, **Save**. Leave *Skip nonce checks* off (the app uses the server-side PKCE flow, not Google One Tap).
2. **Authentication > URL Configuration**:
   - **Site URL**: the production URL of the app (or `http://localhost:3000` while you only run locally).
   - **Redirect URLs**: add `<app url>/auth/callback` for every origin the app runs on, e.g. `http://localhost:3000/auth/callback` and `https://bills-yourname.vercel.app/auth/callback`. Without this, Supabase ignores the app's `redirectTo` and sends users to the Site URL.

**Local Supabase stack**

`supabase/config.toml` already enables Google with `env(GOOGLE_CLIENT_ID)` and `env(GOOGLE_CLIENT_SECRET)`, and allows `http://localhost:3000/auth/callback` and `http://127.0.0.1:3000/auth/callback`. Put the two values in `supabase/.env`:

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

and restart the stack (`npx supabase stop && npx supabase start`).

**The app**

Fill `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local` (see `.env.example`) and on the hosting provider. The Fase 4 sync uses them to exchange the stored refresh token for access tokens; Supabase only uses its own copy for sign-in.

## 8. Check that it works

1. `npm run dev` and open `http://localhost:3000/app`: you are sent to `/login`.
2. **Continue with Google**, pick a test user. The consent screen must list "Read all your email" under Gmail (or "View your email messages and settings"). Tick it if it appears as a checkbox: if it is left unticked, Google does not grant Gmail access.
3. You land back on `/app` with your email shown.
4. In the Supabase dashboard (Table Editor > `gmail_connections`) there is one row for your user with `refresh_token_encrypted` filled in (starts with `v1.`).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Error 400: redirect_uri_mismatch` on Google's page | The Supabase callback URL is missing or slightly different in step 6.4. Copy the URI from the error details. |
| `Error 403: access_denied` on Google's page | The account is not a test user (step 5). |
| Login shows "Google sign-in was cancelled" (`?error=access_denied`) | The user cancelled the consent screen. |
| Back on the app at the Site URL instead of `/app` | `<app url>/auth/callback` is not in Supabase's Redirect URLs (step 7). |
| `/login?error=gmail_token_failed` | The refresh token could not be saved: check `SUPABASE_SERVICE_ROLE_KEY` and `ENCRYPTION_KEY` (32 bytes, base64) in `.env.local`. |
| Signed in, but `gmail_connections` has no row | Google sent no refresh token. The app always asks with `prompt=consent` and `access_type=offline`; if it still happens, remove the app at <https://myaccount.google.com/permissions> and sign in again. |
| Sync fails with `invalid_grant` after about a week | Testing mode refresh token expiry (step 5). Sign in again. |
| Sync fails with `403 accessNotConfigured` | The Gmail API is not enabled (step 2). |
| Sync fails with `403 insufficientPermissions` | The Gmail checkbox was left unticked on the consent screen. Remove the app at <https://myaccount.google.com/permissions> and sign in again, ticking it. |

## Later: mobile (Capacitor)

The Android app (Fase 6) opens Google sign-in in the system browser and comes back through a deep link handled by Supabase, so it reuses this same Web application client and the same Supabase callback. Only the Supabase Redirect URLs list will need the app's deep link added; that is documented in Fase 6.
