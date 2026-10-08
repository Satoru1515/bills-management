-- 0003_sync_runs_server_only: users can read their sync history but no longer
-- write it.
--
-- Every sync is recorded by server code with the service role (src/lib/sync/run.ts),
-- which bypasses RLS. The rows decide whether a sync is already running and how
-- often "Sync now" may be used (src/lib/sync/rate-limit.ts), so a user must not
-- be able to insert, back-date or rewrite them through the API.
-- See docs/rls.md and docs/security.md.

drop policy if exists "sync_runs_insert_own" on public.sync_runs;
drop policy if exists "sync_runs_update_own" on public.sync_runs;

revoke insert, update, delete, truncate on public.sync_runs from anon, authenticated;
