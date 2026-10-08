-- 0004_import_queue: "Import history" as a queue of months.
--
-- Importing many months of Gmail in one request runs into Gmail's per-user quota
-- (requests per minute) and the function time limit. Instead, each month to import
-- is one row here, processed one at a time by server code (src/lib/sync/import-queue.ts)
-- while the dashboard is open and by the scheduled sync. A month that fails or comes
-- back incomplete is retried later, up to a limit.
--
-- Like sync_runs (0003), users can read their queue but only the server (service role,
-- which bypasses RLS) writes it. See docs/rls.md.

create table public.import_months (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The month to import, YYYY-MM (Dominican Republic time, like transactions.month).
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'error', 'failed')),
  -- Runs of this month so far (successful or not).
  attempts integer not null default 0 check (attempts >= 0),
  -- A pending or error month is not picked before this time (retry backoff).
  next_attempt_at timestamptz not null default now(),
  messages_seen integer not null default 0 check (messages_seen >= 0),
  new_transactions integer not null default 0 check (new_transactions >= 0),
  -- Short description of the last failure, without email content.
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);

create index import_months_user_status_idx on public.import_months (user_id, status, month desc);

alter table public.import_months enable row level security;

create policy "import_months_select_own" on public.import_months
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete, truncate on public.import_months from anon, authenticated;

-- Syncs started by the import queue are recorded as trigger 'import'.
alter table public.sync_runs drop constraint sync_runs_trigger_check;
alter table public.sync_runs
  add constraint sync_runs_trigger_check check (trigger in ('manual', 'cron', 'import'));
