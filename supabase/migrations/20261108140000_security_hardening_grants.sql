-- SIGMA 1 — security hardening: close leftover grants found in the 2026-11-08 security review.
-- 1. client_deliverable_reviews was recreated without revoking the default PUBLIC execute, so signed-out
--    callers could call it (it returned nothing, but it should not be callable at all).
-- 2. Supabase's default privileges gave anon/authenticated TRUNCATE, REFERENCES, TRIGGER (and MAINTAIN on
--    Postgres 17) on every new table. The Data API can't use them, but TRUNCATE ignores RLS, so remove them
--    from all existing tables and from the defaults for future tables.
revoke all on function public.client_deliverable_reviews(uuid) from public, anon;
grant execute on function public.client_deliverable_reviews(uuid) to authenticated;

do $$
declare t record; v_maint boolean := current_setting('server_version_num')::int >= 170000;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.relname);
    if v_maint then execute format('revoke maintain on public.%I from anon, authenticated', t.relname); end if;
  end loop;
  alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated;
  if v_maint then
    execute 'alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated';
  end if;
end $$;
