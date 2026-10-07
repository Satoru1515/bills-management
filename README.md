# Bills Management

Personal expense tracker that turns the transaction alerts your banks already send to Gmail into a categorized spending dashboard. No manual entry, no bank API: just the notification emails you already receive.

**Status:** early development. The project is built incrementally by an automated routine that follows `PLAN.md`; see `PROGRESS.md` for the log.

## What it does
- Connects to Gmail (read-only) and reads card-consumption notifications from Scotiabank, APAP, Banco Santa Cruz and PayPal receipts.
- Parses each email into a transaction (date, amount, currency, merchant, card), drops duplicate alerts and auto-categorizes it.
- Shows a monthly dashboard: totals (DOP, USD, converted), spending by category, by bank/card, and a searchable transaction list where categories can be edited.
- Web app (Next.js + Supabase), installable as a PWA and packaged for Android/iOS with Capacitor.

## Stack
Next.js 15 · TypeScript · Tailwind · Supabase (Postgres, Auth, RLS) · Vitest · Capacitor

## Local development
Coming with Phase 0 of the plan.

## License
Apache-2.0
