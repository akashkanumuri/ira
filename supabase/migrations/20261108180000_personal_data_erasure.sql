-- SIGMA 1 — personal data erasure ("right to be forgotten").
--
-- Anyone signed in can ask for their personal data to be erased; admins are alerted.
-- An admin erases a person only after deactivating them, by typing ERASE. Erasure removes or
-- anonymises identity, contact, device, location and session data, and scrubs it from the audit log.
-- Business and legal records stay, without the person's identity: attendance hours, payroll and salary
-- figures, invoices and payments, and signed contract evidence (who signed, from where) which the law
-- requires to be kept.
-- Login and files in storage are cleared by the employee-admin Edge Function, which calls this function.

-- 1) Requests ---------------------------------------------------------------------------------------
create table if not exists public.data_erasure_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  note text check (note is null or length(note) <= 1000),
  requested_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null
);
create index if not exists data_erasure_requests_open_idx on public.data_erasure_requests(requested_at desc) where handled_at is null;
alter table public.data_erasure_requests enable row level security;
drop policy if exists data_erasure_requests_select on public.data_erasure_requests;
create policy data_erasure_requests_select on public.data_erasure_requests for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_admin());
revoke all on public.data_erasure_requests from anon;
revoke insert, update, delete, truncate, references, trigger on public.data_erasure_requests from authenticated;
grant select on public.data_erasure_requests to authenticated;

/** Signed-in person asks for their personal data to be erased. One open request at a time. */
create or replace function public.request_my_data_erasure(p_note text default null)
 returns text language plpgsql security definer set search_path to ''
as $function$
declare v_uid uuid := auth.uid(); v_id uuid; v_who text; r record;
begin
  perform private.require(v_uid is not null, 'Please sign in again');
  if exists (select 1 from public.data_erasure_requests where profile_id = v_uid and handled_at is null) then
    return 'Your request is already with the admin.';
  end if;
  insert into public.data_erasure_requests(profile_id, note) values (v_uid, nullif(btrim(left(coalesce(p_note, ''), 1000)), ''))
  returning id into v_id;
  v_who := coalesce(private.person_label(v_uid), 'Someone');
  for r in select p.id from public.profiles p where p.role = 'admin' loop
    perform private.notify(r.id, 'system', 'Personal data erasure requested',
      v_who || ' asked for their personal data to be erased. Deactivate the account, then use "Erase personal data".',
      null, 'erasure-request:' || v_id, jsonb_build_object('priority', 'high', 'request_id', v_id, 'profile_id', v_uid));
  end loop;
  return 'Your request has been sent. The admin will confirm when it is done.';
end $function$;
revoke all on function public.request_my_data_erasure(text) from public, anon;
grant execute on function public.request_my_data_erasure(text) to authenticated;

/** Open requests for the admin screen. */
create or replace function public.staff_data_erasure_requests()
 returns table(id uuid, profile_id uuid, person text, note text, requested_at timestamptz)
 language sql stable security definer set search_path to ''
as $function$
  select r.id, r.profile_id, coalesce(private.person_label(r.profile_id), 'Unknown'), r.note, r.requested_at
  from public.data_erasure_requests r
  where r.handled_at is null and private.is_admin()
  order by r.requested_at desc
$function$;
revoke all on function public.staff_data_erasure_requests() from public, anon;
grant execute on function public.staff_data_erasure_requests() to authenticated;

-- 2) Let an erasure scrub the audit log (and only an erasure) --------------------------------------
create or replace function private.forbid_mutation()
 returns trigger language plpgsql set search_path to ''
as $function$
begin
  -- The single exception: an admin-run personal data erasure may redact audit entries (never delete them).
  if tg_op = 'UPDATE' and tg_table_name = 'audit_logs' and current_setting('sigma.erasure', true) = 'on' then
    return new;
  end if;
  raise exception '% records are immutable', tg_table_name using errcode = 'P0001';
end $function$;

-- While erasing, the audit log records which fields changed — never the old values.
create or replace function private.audit_row_change()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_row jsonb := case when tg_op = 'DELETE' then v_old else v_new end;
  v_changes jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at') and (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;
  elsif tg_op = 'INSERT' then
    v_changes := v_new - 'token_hash';
  else
    v_changes := v_old - 'token_hash';
  end if;
  if current_setting('sigma.erasure', true) = 'on' then
    v_changes := jsonb_build_object('personal_data_erased', true,
      'fields', coalesce((select jsonb_agg(x order by x) from jsonb_object_keys(v_changes) x), '[]'::jsonb));
  end if;
  insert into public.audit_logs(actor_id, actor_role, client_id, project_id, entity_type, entity_id, action, changes, reason, ip_address)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()),
          case when tg_table_name = 'clients' then (v_row ->> 'id')::uuid else (v_row ->> 'client_id')::uuid end,
          case when tg_table_name = 'projects' then (v_row ->> 'id')::uuid else (v_row ->> 'project_id')::uuid end,
          tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'project_id'), lower(tg_op), v_changes,
          nullif(current_setting('sigma.change_reason', true), ''), private.request_ip());
  return null;
end $function$;

-- 3) Helpers ------------------------------------------------------------------------------------------
/** Replace exact JSON string values equal to any of the given values with "[erased]" (recursively). */
create or replace function private.jsonb_scrub(p jsonb, p_values text[])
 returns jsonb language plpgsql immutable set search_path to ''
as $function$
declare k text; v jsonb; out jsonb;
begin
  if p is null then return null; end if;
  case jsonb_typeof(p)
    when 'object' then
      out := '{}'::jsonb;
      for k, v in select * from jsonb_each(p) loop out := out || jsonb_build_object(k, private.jsonb_scrub(v, p_values)); end loop;
      return out;
    when 'array' then
      return coalesce((select jsonb_agg(private.jsonb_scrub(e, p_values) order by i) from jsonb_array_elements(p) with ordinality as t(e, i)), '[]'::jsonb);
    when 'string' then
      if lower(p #>> '{}') = any (p_values) then return to_jsonb('[erased]'::text); end if;
      return p;
    else return p;
  end case;
end $function$;

/** Replace whole-word mentions of the values inside free text. */
create or replace function private.text_scrub(p text, p_values text[], p_with text)
 returns text language plpgsql immutable set search_path to ''
as $function$
declare v text; out text := p;
begin
  if p is null then return null; end if;
  foreach v in array p_values loop
    if length(v) >= 3 then
      out := regexp_replace(out, '(^|[^[:alnum:]_@.])' || regexp_replace(v, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '($|[^[:alnum:]_@])', '\1' || p_with || '\2', 'gi');
    end if;
  end loop;
  return out;
end $function$;

-- 4) The erasure --------------------------------------------------------------------------------------
/**
 * Admin-only. p_profile = the person's login (profiles.id). The account must already be deactivated,
 * and p_confirm must be 'ERASE'. Returns what the Edge Function still has to clear (files + login).
 * Running it again on the same person is harmless.
 */
create or replace function public.staff_erase_person(p_profile uuid, p_confirm text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_role text; e public.employees; cu public.client_users; c public.clients;
  v_values text[] := '{}'; v_label text; v_files jsonb := '[]'::jsonb; v_counts jsonb := '{}'::jsonb; n int; v_like text[];
begin
  perform private.require(private.is_admin(), 'Only an admin can erase personal data');
  perform private.require(p_confirm = 'ERASE', 'Type ERASE to confirm');
  perform private.require(p_profile is distinct from auth.uid(), 'You cannot erase your own account');
  select role into v_role from public.profiles where id = p_profile;
  perform private.require(v_role is not null, 'Person not found');
  perform private.require(v_role <> 'admin', 'Admin accounts cannot be erased here');

  if v_role = 'client' then
    select * into cu from public.client_users where profile_id = p_profile;
    select * into c from public.clients where profile_id = p_profile and deleted_at is null;
    perform private.require(cu.id is not null or c.id is not null, 'Client login not found');
    perform private.require(coalesce(cu.status, c.status) = 'inactive', 'Deactivate this person first, then erase their data');
    v_values := array_remove(array[lower(btrim(cu.full_name)), lower(btrim(cu.email)),
                                   lower(btrim(case when c.id is not null then c.primary_contact end)),
                                   lower(btrim(case when c.id is not null then c.email end)),
                                   lower(btrim(case when c.id is not null then c.phone end))], null);
    v_label := 'Former contact';
  else
    select * into e from public.employees where profile_id = p_profile;
    perform private.require(e.id is not null, 'Employee not found');
    perform private.require(e.status = 'inactive', 'Deactivate this employee first, then erase their data');
    v_values := array_remove(array[lower(btrim(e.name)), lower(btrim(e.work_email)), lower(btrim(e.phone)),
                                   lower(btrim(e.login_id)), lower(btrim(e.login_id)) || '@employee.ira.local'], null);
    v_label := 'Former employee ' || e.emp_id;
  end if;
  v_values := array(select distinct x from unnest(v_values) x where x <> '' and x !~ '^(\[erased|former (employee|contact)|erased-)');

  perform set_config('sigma.erasure', 'on', true);
  perform set_config('sigma.change_reason', 'Personal data erasure', true);

  -- Identity and contact details
  if v_role = 'client' then
    if cu.id is not null then
      update public.client_users set full_name = v_label, email = null where id = cu.id;
      delete from public.client_password_requests where client_user_id = cu.id or lower(email) = any (v_values);
      delete from public.client_invitations where client_id = cu.client_id and lower(email) = any (v_values);
    end if;
    if c.id is not null then -- the client's main login: anonymise the company's contact person
      update public.clients set primary_contact = v_label, email = 'erased-' || c.id || '@erased.invalid', phone = null where id = c.id;
      delete from public.client_password_requests where client_id = c.id and lower(email) = any (v_values);
    end if;
  else
    if e.avatar_url is not null then
      v_files := v_files || jsonb_build_array(jsonb_build_object('bucket', 'avatars',
        'path', regexp_replace(e.avatar_url, '^.*/storage/v1/object/(public|sign)/avatars/([^?]+).*$', '\2')));
    end if;
    select v_files || coalesce(jsonb_agg(jsonb_build_object('bucket', 'hr-documents', 'path', storage_path)), '[]'::jsonb)
      into v_files from public.employee_documents where employee_id = e.id and storage_path is not null;
    delete from public.employee_documents where employee_id = e.id;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('documents', n);
    update public.employees set name = v_label, work_email = null, phone = null, avatar_url = null,
      login_id = 'erased-' || left(replace(e.id::text, '-', ''), 12) where id = e.id;
    -- Device and location traces from attendance
    update public.attendance_events ev set user_agent = null, metadata = ev.metadata - 'geo'
      from public.attendance a where a.id = ev.attendance_id and a.employee_id = e.id
        and (ev.user_agent is not null or ev.metadata ? 'geo');
    delete from public.employee_device_locks where profile_id = p_profile;
  end if;

  -- Sessions, devices, inbox
  update public.auth_sessions set user_agent = null where user_id = p_profile and user_agent is not null;
  delete from public.push_subscriptions where user_id = p_profile;
  delete from public.notifications where recipient_id = p_profile;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('notifications', n);

  -- Their name on comments and requests they wrote
  update public.deliverable_comments set author_name = v_label where author_id = p_profile and author_name is distinct from v_label;
  update public.support_messages set author_name = v_label where author_id = p_profile and author_name is distinct from v_label;
  update public.change_requests set requested_by_name = v_label where requested_by = p_profile and requested_by_name is distinct from v_label;

  -- Mentions in other people's notifications
  if array_length(v_values, 1) > 0 then
    v_like := array(select '%' || replace(replace(replace(x, '\', '\\'), '%', '\%'), '_', '\_') || '%' from unnest(v_values) x);
    update public.notifications set
      title = private.text_scrub(title, v_values, v_label),
      message = private.text_scrub(message, v_values, v_label),
      metadata = private.jsonb_scrub(metadata, v_values)
    where lower(coalesce(title, '') || ' ' || coalesce(message, '') || ' ' || coalesce(metadata::text, '')) like any (v_like);
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('mentions_scrubbed', n);

    -- Audit log: keep every entry, redact the personal values and the person's IP addresses
    update public.audit_logs set changes = private.jsonb_scrub(changes, v_values), metadata = private.jsonb_scrub(metadata, v_values)
    where lower(changes::text || ' ' || coalesce(metadata, '{}')::text) like any (v_like);
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('audit_entries_redacted', n);
  end if;
  update public.audit_logs set ip_address = null where actor_id = p_profile and ip_address is not null;

  -- Close their requests and the admins' alerts
  update public.data_erasure_requests set handled_at = now(), handled_by = auth.uid() where profile_id = p_profile and handled_at is null;

  perform set_config('sigma.erasure', 'off', true);
  perform private.audit('person', p_profile::text, 'personal_data_erased', jsonb_build_object('role', v_role, 'counts', v_counts),
                        'Personal data erasure', null, null, '{}'::jsonb);

  return jsonb_build_object('role', v_role, 'files', v_files, 'counts', v_counts);
end $function$;
revoke all on function public.staff_erase_person(uuid, text) from public, anon;
grant execute on function public.staff_erase_person(uuid, text) to authenticated;
