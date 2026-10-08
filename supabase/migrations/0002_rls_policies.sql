-- 0002_rls_policies: every signed-in user sees and edits only their own rows.
--
-- RLS was enabled in 0001_init. Policies are granted to `authenticated` only,
-- so `anon` reads nothing. `service_role` bypasses RLS (server-side cron sync).
-- `(select auth.uid())` is evaluated once per statement instead of per row.
-- See docs/rls.md for the manual check.

-- ---------------------------------------------------------------------------
-- profiles: read and update your own; created by the sign-up trigger,
-- deleted with the auth user.
-- ---------------------------------------------------------------------------

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- gmail_connections: full access to your own row, but the encrypted refresh
-- token is never readable through the API (only server code with the
-- service role decrypts it).
-- ---------------------------------------------------------------------------

create policy "gmail_connections_select_own" on public.gmail_connections
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "gmail_connections_insert_own" on public.gmail_connections
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "gmail_connections_update_own" on public.gmail_connections
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "gmail_connections_delete_own" on public.gmail_connections
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke select on public.gmail_connections from anon, authenticated;
grant select (user_id, email, scope, last_history_id, last_sync_at, created_at, updated_at)
  on public.gmail_connections to authenticated;

-- ---------------------------------------------------------------------------
-- transactions and category_rules: full access to your own rows.
-- ---------------------------------------------------------------------------

create policy "transactions_select_own" on public.transactions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "transactions_insert_own" on public.transactions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "transactions_update_own" on public.transactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "transactions_delete_own" on public.transactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "category_rules_select_own" on public.category_rules
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "category_rules_insert_own" on public.category_rules
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "category_rules_update_own" on public.category_rules
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "category_rules_delete_own" on public.category_rules
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- sync_runs: read, start and finish your own runs; the history is kept
-- (no delete; rows go away with the user).
-- ---------------------------------------------------------------------------

create policy "sync_runs_select_own" on public.sync_runs
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "sync_runs_insert_own" on public.sync_runs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "sync_runs_update_own" on public.sync_runs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
