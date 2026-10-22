-- SIGMA 1 — Private file storage and scheduled billing evaluation

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('sigma-files', 'sigma-files', false, 52428800, array[
  'application/pdf','image/jpeg','image/png','image/webp','image/gif',
  'application/zip','application/x-zip-compressed',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv','video/mp4','video/quicktime','audio/mpeg',
  'image/vnd.adobe.photoshop','application/postscript','application/illustrator'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_read_storage_object(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.files f where f.storage_bucket = p_bucket and f.storage_path = p_name
                 and private.can_read_file(f.id))
$$;
revoke execute on function private.can_read_storage_object(text, text) from public, anon;
grant execute on function private.can_read_storage_object(text, text) to authenticated;

-- Upload only into your own folder: sigma-files/<auth.uid()>/<uuid>-<name>
drop policy if exists sigma_files_insert_own on storage.objects;
create policy sigma_files_insert_own on storage.objects for insert to authenticated with check (
  bucket_id = 'sigma-files' and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Read: the uploader (own folder), otherwise whoever may read the file record
-- (enforces client isolation, visibility and payment-lock rules).
drop policy if exists sigma_files_select on storage.objects;
create policy sigma_files_select on storage.objects for select to authenticated using (
  bucket_id = 'sigma-files' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or private.can_read_storage_object(bucket_id, name)
  )
);
-- No update/delete policies: stored objects are immutable; new versions are new objects.

-- Hourly billing evaluation (statuses, reminders, overdue alerts, locks, expiry).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sigma-billing-refresh') then
    perform cron.unschedule('sigma-billing-refresh');
  end if;
  perform cron.schedule('sigma-billing-refresh', '7 * * * *', 'select private.refresh_billing_state();');
end $$;

-- Least privilege for tables created by the SIGMA migrations (Supabase grants
-- broad default privileges on new public tables).
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p','v','m')
  loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', r.relname);
  end loop;
end $$;
revoke insert, update, delete on public.audit_logs, public.contract_versions, public.deliverable_versions,
  public.deliverable_lock_events, public.files, public.payments, public.deliverable_dependencies,
  public.roles, public.permissions from authenticated;
