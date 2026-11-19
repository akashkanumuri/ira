-- Leads & Sales: public actions (SECURITY DEFINER, each checks permission and ownership).

create or replace function public.lead_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.current_employee_id();
  v_manage boolean := private.has_permission('lead.manage');
  v_owner uuid;
  v_phone text := private.clean(p->>'phone', 20);
  v_email text := private.clean(p->>'email', 160);
  v_dup text;
  v_channel text := coalesce(nullif(p->>'channel', ''), 'calling');
  v_row public.leads;
begin
  perform private.require(private.has_permission('lead.call'), 'You do not have access to leads.');
  perform private.require(private.clean(p->>'contact_name', 120) is not null, 'Enter the contact name.');
  perform private.require(private.norm_phone(v_phone) is not null or private.norm_email(v_email) is not null,
    'Enter a phone number or an email.');
  perform private.require(v_email is null or v_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'That email does not look right.');
  perform private.require(v_channel in ('calling','field'), 'Unknown team.');
  perform private.require(coalesce(nullif(p->>'source', ''), 'other') in ('meta_ads','google_ads','instagram','website','whatsapp','referral','walk_in','field_visit','phone_call','event','other'), 'Unknown lead source.');
  perform private.require(v_channel <> 'field' or private.has_permission('lead.visit'), 'Only field sales can add field leads.');

  if v_manage and nullif(p->>'owner_id', '') is not null then
    v_owner := (p->>'owner_id')::uuid;
    perform private.require(private.is_sales_employee(v_owner), 'That person is not in the sales team.');
  else
    v_owner := v_me;
  end if;

  v_dup := private.lead_duplicate(private.norm_phone(v_phone), private.norm_email(v_email), null);
  perform private.require(v_dup is null, 'This contact is already in leads: ' || coalesce(v_dup, '') || '.');

  insert into public.leads (contact_name, company, designation, phone, phone_norm, email, email_norm, city, address,
    industry, source, campaign, service_interest, channel, notes, owner_id, created_by, next_follow_up_at)
  values (private.clean(p->>'contact_name', 120), private.clean(p->>'company', 160), private.clean(p->>'designation', 80),
    v_phone, private.norm_phone(v_phone), v_email, private.norm_email(v_email), private.clean(p->>'city', 80),
    private.clean(p->>'address', 400), private.clean(p->>'industry', 80), coalesce(nullif(p->>'source', ''), 'other'),
    private.clean(p->>'campaign', 120), private.clean(p->>'service_interest', 200), v_channel,
    private.clean(p->>'notes', 2000), v_owner, auth.uid(), nullif(p->>'next_follow_up_at', '')::timestamptz)
  returning * into v_row;

  insert into public.lead_activities (lead_id, kind, note, by_profile, by_employee)
  values (v_row.id, 'created', null, auth.uid(), v_me);

  if v_owner is not null and v_owner is distinct from v_me then
    perform private.notify_employee(v_owner, 'lead', 'New lead for you',
      v_row.lead_no || ' · ' || coalesce(v_row.company, v_row.contact_name), '/emp-leads', 'lead_assign_' || v_row.id || '_' || v_owner);
  end if;
  return jsonb_build_object('id', v_row.id, 'lead_no', v_row.lead_no);
end $$;

create or replace function public.lead_update(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.leads; v_phone text; v_email text; v_dup text;
begin
  perform private.require(private.can_work_lead(p_id), 'You cannot edit this lead.');
  select * into v from public.leads where id = p_id for update;
  perform private.require(v.stage not in ('won'), 'This lead is already a client.');
  v_phone := case when p ? 'phone' then private.clean(p->>'phone', 20) else v.phone end;
  v_email := case when p ? 'email' then private.clean(p->>'email', 160) else v.email end;
  perform private.require(private.norm_phone(v_phone) is not null or private.norm_email(v_email) is not null,
    'Keep a phone number or an email.');
  perform private.require(v_email is null or v_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'That email does not look right.');
  v_dup := private.lead_duplicate(private.norm_phone(v_phone), private.norm_email(v_email), p_id);
  perform private.require(v_dup is null, 'This contact is already in leads: ' || coalesce(v_dup, '') || '.');
  perform private.require(not (p ? 'contact_name') or private.clean(p->>'contact_name', 120) is not null, 'Enter the contact name.');
  perform private.require(not (p ? 'source') or coalesce(nullif(p->>'source', ''), 'other') in ('meta_ads','google_ads','instagram','website','whatsapp','referral','walk_in','field_visit','phone_call','event','other'), 'Unknown lead source.');

  update public.leads set
    contact_name = case when p ? 'contact_name' then private.clean(p->>'contact_name', 120) else contact_name end,
    company = case when p ? 'company' then private.clean(p->>'company', 160) else company end,
    designation = case when p ? 'designation' then private.clean(p->>'designation', 80) else designation end,
    phone = v_phone, phone_norm = private.norm_phone(v_phone),
    email = v_email, email_norm = private.norm_email(v_email),
    city = case when p ? 'city' then private.clean(p->>'city', 80) else city end,
    address = case when p ? 'address' then private.clean(p->>'address', 400) else address end,
    industry = case when p ? 'industry' then private.clean(p->>'industry', 80) else industry end,
    source = case when p ? 'source' then coalesce(nullif(p->>'source', ''), 'other') else source end,
    campaign = case when p ? 'campaign' then private.clean(p->>'campaign', 120) else campaign end,
    service_interest = case when p ? 'service_interest' then private.clean(p->>'service_interest', 200) else service_interest end,
    notes = case when p ? 'notes' then private.clean(p->>'notes', 2000) else notes end,
    need = case when p ? 'need' then private.clean(p->>'need', 1000) else need end,
    budget = case when p ? 'budget' then private.clean(p->>'budget', 120) else budget end,
    timeline = case when p ? 'timeline' then private.clean(p->>'timeline', 120) else timeline end,
    decision_maker = case when p ? 'decision_maker' then private.clean(p->>'decision_maker', 120) else decision_maker end,
    next_follow_up_at = case when p ? 'next_follow_up_at' then nullif(p->>'next_follow_up_at', '')::timestamptz else next_follow_up_at end,
    updated_at = now()
  where id = p_id;
end $$;

create or replace function public.lead_log_call(p_id uuid, p_outcome text, p_note text, p_next timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.leads;
begin
  perform private.require(private.can_work_lead(p_id), 'You cannot work on this lead.');
  select * into v from public.leads where id = p_id for update;
  perform private.require(v.stage in ('new','calling','good','with_admin'), 'This lead is closed.');
  perform private.require(p_outcome in ('connected','no_answer','busy','call_back','not_interested','interested','wrong_number'),
    'Choose what happened on the call.');
  perform private.require(p_outcome <> 'call_back' or p_next is not null, 'Pick when to call back.');
  perform private.require(p_next is null or p_next > now() - interval '5 minutes', 'The follow-up time is in the past.');
  insert into public.lead_activities (lead_id, kind, outcome, note, by_profile, by_employee)
  values (p_id, 'call', p_outcome, private.clean(p_note, 2000), auth.uid(), private.current_employee_id());
  update public.leads set
    call_count = call_count + 1,
    first_contacted_at = coalesce(first_contacted_at, now()),
    last_contacted_at = now(),
    next_follow_up_at = p_next,
    stage = case when stage = 'new' then 'calling' else stage end,
    updated_at = now()
  where id = p_id;
end $$;

create or replace function public.lead_add_note(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.can_work_lead(p_id), 'You cannot work on this lead.');
  perform private.require(private.clean(p_note, 2000) is not null, 'Write a note.');
  insert into public.lead_activities (lead_id, kind, note, by_profile, by_employee)
  values (p_id, 'note', private.clean(p_note, 2000), auth.uid(), private.current_employee_id());
  update public.leads set updated_at = now() where id = p_id;
end $$;

create or replace function public.lead_mark_good(p_id uuid, p_need text, p_budget text, p_timeline text, p_decision_maker text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.leads; v_by text;
begin
  perform private.require(private.can_work_lead(p_id), 'You cannot work on this lead.');
  select * into v from public.leads where id = p_id for update;
  perform private.require(v.stage in ('new','calling'), 'Only open leads can be marked good.');
  perform private.require(private.clean(p_need, 1000) is not null, 'What do they need?');
  perform private.require(private.clean(p_budget, 120) is not null, 'What is their budget?');
  perform private.require(private.clean(p_timeline, 120) is not null, 'When do they want to start?');
  perform private.require(private.clean(p_decision_maker, 120) is not null, 'Who makes the decision?');
  update public.leads set stage = 'good', need = private.clean(p_need, 1000), budget = private.clean(p_budget, 120),
    timeline = private.clean(p_timeline, 120), decision_maker = private.clean(p_decision_maker, 120),
    qualified_at = now(), qualified_by = auth.uid(), next_follow_up_at = null, updated_at = now()
  where id = p_id;
  insert into public.lead_activities (lead_id, kind, outcome, note, by_profile, by_employee)
  values (p_id, 'stage', 'good', private.clean(p_note, 2000), auth.uid(), private.current_employee_id());
  select coalesce((select e.name from public.employees e where e.profile_id = auth.uid() limit 1), 'Admin') into v_by;
  perform private.notify_lead_managers('Good lead: ' || coalesce(v.company, v.contact_name),
    v.lead_no || ' · marked good by ' || coalesce(v_by, 'sales') || '. Budget ' || private.clean(p_budget, 120) || '.',
    'lead_good_' || p_id);
end $$;

create or replace function public.lead_mark_lost(p_id uuid, p_reason text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.leads;
begin
  perform private.require(private.can_work_lead(p_id), 'You cannot work on this lead.');
  select * into v from public.leads where id = p_id for update;
  perform private.require(v.stage not in ('won','lost'), 'This lead is already closed.');
  perform private.require(private.clean(p_reason, 400) is not null, 'Say why the lead is lost.');
  perform private.require(v.stage not in ('good','with_admin') or private.has_permission('lead.manage'),
    'This lead is with admin now. Ask admin to close it.');
  update public.leads set stage = 'lost', lost_reason = private.clean(p_reason, 400), closed_at = now(),
    next_follow_up_at = null, updated_at = now() where id = p_id;
  insert into public.lead_activities (lead_id, kind, outcome, note, by_profile, by_employee, metadata)
  values (p_id, 'stage', 'lost', private.clean(p_note, 2000), auth.uid(), private.current_employee_id(),
    jsonb_build_object('reason', private.clean(p_reason, 400), 'from', v.stage));
  perform private.audit('lead', p_id::text, 'lost', jsonb_build_object('from', v.stage), private.clean(p_reason, 400), null, null, '{}'::jsonb);
end $$;

create or replace function public.lead_reopen(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.leads;
begin
  perform private.require(private.has_permission('lead.manage'), 'Only a sales manager or admin can reopen a lead.');
  select * into v from public.leads where id = p_id for update;
  perform private.require(v.id is not null and v.stage = 'lost', 'Only lost leads can be reopened.');
  perform private.require(private.lead_duplicate(v.phone_norm, v.email_norm, p_id) is null, 'This contact is already in leads again.');
  update public.leads set stage = 'calling', lost_reason = null, closed_at = null, updated_at = now() where id = p_id;
  insert into public.lead_activities (lead_id, kind, outcome, note, by_profile, metadata)
  values (p_id, 'stage', null, private.clean(p_note, 2000), auth.uid(), jsonb_build_object('reopened', true));
  perform private.audit('lead', p_id::text, 'reopen', '{}'::jsonb, private.clean(p_note, 2000), null, null, '{}'::jsonb);
end $$;

create or replace function public.lead_assign(p_id uuid, p_employee uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.leads;
begin
  perform private.require(private.has_permission('lead.manage'), 'Only a sales manager or admin can assign leads.');
  select * into v from public.leads where id = p_id for update;
  perform private.require(v.id is not null, 'Lead not found.');
  perform private.require(v.stage not in ('won'), 'This lead is already a client.');
  perform private.require(p_employee is null or private.is_sales_employee(p_employee), 'That person is not in the sales team.');
  if v.owner_id is not distinct from p_employee then return; end if;
  update public.leads set owner_id = p_employee, updated_at = now() where id = p_id;
  insert into public.lead_activities (lead_id, kind, by_profile, metadata)
  values (p_id, 'assign', auth.uid(), jsonb_build_object('from', v.owner_id, 'to', p_employee));
  perform private.audit('lead', p_id::text, 'assign', jsonb_build_object('from', v.owner_id, 'to', p_employee), null, null, null, '{}'::jsonb);
  if p_employee is not null then
    perform private.notify_employee(p_employee, 'lead', 'Lead assigned to you',
      v.lead_no || ' · ' || coalesce(v.company, v.contact_name), '/emp-leads', 'lead_assign_' || p_id || '_' || p_employee);
  end if;
end $$;

create or replace function public.lead_take(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.leads;
begin
  perform private.require(private.has_permission('lead.manage'), 'Only a sales manager or admin can take a good lead.');
  select * into v from public.leads where id = p_id for update;
  perform private.require(v.id is not null and v.stage = 'good', 'Only good leads can be taken.');
  update public.leads set stage = 'with_admin', handled_by = auth.uid(), updated_at = now() where id = p_id;
  insert into public.lead_activities (lead_id, kind, by_profile, metadata)
  values (p_id, 'stage', auth.uid(), jsonb_build_object('to', 'with_admin'));
  if v.owner_id is not null then
    perform private.notify_employee(v.owner_id, 'lead', 'Admin picked up your lead',
      v.lead_no || ' · ' || coalesce(v.company, v.contact_name), '/emp-leads', 'lead_take_' || p_id);
  end if;
end $$;

create or replace function public.lead_mark_won(p_id uuid, p_client_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.leads;
begin
  perform private.require(private.has_permission('lead.manage') and private.has_permission('client.create'),
    'Only admin can turn a lead into a client.');
  select * into v from public.leads where id = p_id for update;
  perform private.require(v.id is not null and v.stage in ('good','with_admin'), 'Only good leads can become clients.');
  perform private.require(exists (select 1 from public.clients c where c.id = p_client_id), 'Client not found.');
  perform private.require(not exists (select 1 from public.leads l where l.client_id = p_client_id and l.id <> p_id),
    'Another lead is already linked to this client.');
  update public.leads set stage = 'won', client_id = p_client_id, closed_at = now(), handled_by = coalesce(handled_by, auth.uid()),
    next_follow_up_at = null, updated_at = now() where id = p_id;
  insert into public.lead_activities (lead_id, kind, outcome, by_profile, metadata)
  values (p_id, 'convert', null, auth.uid(), jsonb_build_object('client_id', p_client_id));
  perform private.audit('lead', p_id::text, 'won', jsonb_build_object('client_id', p_client_id), null, p_client_id, null, '{}'::jsonb);
  if v.owner_id is not null then
    perform private.notify_employee(v.owner_id, 'lead', 'Your lead became a client 🎉',
      v.lead_no || ' · ' || coalesce(v.company, v.contact_name), '/emp-leads', 'lead_won_' || p_id);
  end if;
end $$;

-- Field visits: one open visit per person; location is required at start and end.
create or replace function public.lead_visit_start(p_id uuid, p_lat double precision, p_lng double precision, p_accuracy double precision)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.current_employee_id(); v public.leads; v_act uuid;
begin
  perform private.require(private.has_permission('lead.visit') and v_me is not null, 'Only field sales can log visits.');
  perform private.require(private.can_work_lead(p_id), 'You cannot work on this lead.');
  select * into v from public.leads where id = p_id;
  perform private.require(v.stage in ('new','calling','good','with_admin'), 'This lead is closed.');
  perform private.require(p_lat between -90 and 90 and p_lng between -180 and 180 and p_accuracy >= 0, 'Location is missing.');
  perform private.require(not exists (select 1 from public.lead_activities a where a.by_employee = v_me and a.kind = 'visit'
    and a.ended_at is null and a.started_at > now() - interval '12 hours'), 'Finish your current visit first.');
  insert into public.lead_activities (lead_id, kind, by_profile, by_employee, started_at, start_lat, start_lng, start_accuracy)
  values (p_id, 'visit', auth.uid(), v_me, now(), p_lat, p_lng, p_accuracy) returning id into v_act;
  return v_act;
end $$;

create or replace function public.lead_visit_end(p_activity uuid, p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_outcome text, p_note text, p_next timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.current_employee_id(); a public.lead_activities;
begin
  perform private.require(private.has_permission('lead.visit') and v_me is not null, 'Only field sales can log visits.');
  select * into a from public.lead_activities where id = p_activity for update;
  perform private.require(a.id is not null and a.kind = 'visit' and a.by_employee = v_me, 'Visit not found.');
  perform private.require(a.ended_at is null, 'This visit is already finished.');
  perform private.require(p_lat between -90 and 90 and p_lng between -180 and 180 and p_accuracy >= 0, 'Location is missing.');
  perform private.require(p_outcome in ('met','not_available','follow_up'), 'Choose how the visit went.');
  perform private.require(p_outcome <> 'follow_up' or p_next is not null, 'Pick the follow-up date.');
  perform private.require(p_next is null or p_next > now() - interval '5 minutes', 'The follow-up time is in the past.');
  update public.lead_activities set ended_at = now(), end_lat = p_lat, end_lng = p_lng, end_accuracy = p_accuracy,
    outcome = p_outcome, note = private.clean(p_note, 2000) where id = p_activity;
  update public.leads set visit_count = visit_count + 1, first_contacted_at = coalesce(first_contacted_at, now()),
    last_contacted_at = now(), next_follow_up_at = coalesce(p_next, next_follow_up_at),
    stage = case when stage = 'new' then 'calling' else stage end, updated_at = now()
  where id = a.lead_id;
end $$;

-- Bulk import (sales managers/admin). Skips duplicates and bad rows; returns what happened per row.
create or replace function public.lead_import(p_rows jsonb, p_owner uuid, p_source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; i int := 0; v_ok int := 0; v_skip jsonb := '[]'::jsonb;
  v_phone text; v_email text; v_dup text; v_id uuid; v_src text;
  v_seen_p text[] := '{}'; v_seen_e text[] := '{}';
begin
  perform private.require(private.has_permission('lead.manage'), 'Only a sales manager or admin can import leads.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 1 and 1000, 'Import 1 to 1000 rows at a time.');
  perform private.require(p_owner is null or private.is_sales_employee(p_owner), 'That person is not in the sales team.');
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_phone := private.clean(r->>'phone', 20);
    v_email := private.clean(r->>'email', 160);
    v_src := coalesce(nullif(r->>'source', ''), nullif(p_source, ''), 'other');
    if private.clean(r->>'contact_name', 120) is null then
      v_skip := v_skip || jsonb_build_object('row', i, 'reason', 'No name'); continue; end if;
    if private.norm_phone(v_phone) is null and private.norm_email(v_email) is null then
      v_skip := v_skip || jsonb_build_object('row', i, 'reason', 'No phone or email'); continue; end if;
    if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_skip := v_skip || jsonb_build_object('row', i, 'reason', 'Bad email'); continue; end if;
    if v_src not in ('meta_ads','google_ads','instagram','website','whatsapp','referral','walk_in','field_visit','phone_call','event','other') then
      v_src := 'other'; end if;
    if private.norm_phone(v_phone) = any(v_seen_p) or private.norm_email(v_email) = any(v_seen_e) then
      v_skip := v_skip || jsonb_build_object('row', i, 'reason', 'Repeated in this file'); continue; end if;
    v_dup := private.lead_duplicate(private.norm_phone(v_phone), private.norm_email(v_email), null);
    if v_dup is not null then
      v_skip := v_skip || jsonb_build_object('row', i, 'reason', 'Already in leads: ' || v_dup); continue; end if;
    insert into public.leads (contact_name, company, designation, phone, phone_norm, email, email_norm, city, industry,
      source, campaign, service_interest, notes, owner_id, created_by)
    values (private.clean(r->>'contact_name', 120), private.clean(r->>'company', 160), private.clean(r->>'designation', 80),
      v_phone, private.norm_phone(v_phone), v_email, private.norm_email(v_email), private.clean(r->>'city', 80),
      private.clean(r->>'industry', 80), v_src, private.clean(r->>'campaign', 120), private.clean(r->>'service_interest', 200),
      private.clean(r->>'notes', 2000), p_owner, auth.uid())
    returning id into v_id;
    insert into public.lead_activities (lead_id, kind, by_profile) values (v_id, 'import', auth.uid());
    if private.norm_phone(v_phone) is not null then v_seen_p := v_seen_p || private.norm_phone(v_phone); end if;
    if private.norm_email(v_email) is not null then v_seen_e := v_seen_e || private.norm_email(v_email); end if;
    v_ok := v_ok + 1;
  end loop;
  perform private.audit('lead', 'import', 'import', jsonb_build_object('created', v_ok, 'skipped', jsonb_array_length(v_skip)), null, null, null, '{}'::jsonb);
  if p_owner is not null and v_ok > 0 then
    perform private.notify_employee(p_owner, 'lead', v_ok || ' new leads for you', 'Imported by your manager', '/emp-leads',
      'lead_import_' || p_owner || '_' || extract(epoch from now())::bigint);
  end if;
  return jsonb_build_object('created', v_ok, 'skipped', v_skip);
end $$;

-- Admin: give or remove sales access for an employee (one sales role at a time).
create or replace function public.set_sales_role(p_employee uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_profile uuid;
begin
  perform private.require(private.is_admin() or private.has_permission('rbac.manage'), 'Only admin can change sales access.');
  perform private.require(p_role is null or p_role in ('sales_caller','sales_field','sales_manager'), 'Unknown sales role.');
  select profile_id into v_profile from public.employees where id = p_employee and status = 'active';
  perform private.require(v_profile is not null, 'Employee not found.');
  delete from public.user_roles where user_id = v_profile and role_code in ('sales_caller','sales_field','sales_manager')
    and role_code is distinct from p_role;
  if p_role is not null then
    insert into public.user_roles (user_id, role_code, granted_by, granted_at)
    select v_profile, p_role, auth.uid(), now()
    where not exists (select 1 from public.user_roles where user_id = v_profile and role_code = p_role);
  end if;
  perform private.audit('employee', p_employee::text, 'sales_role', jsonb_build_object('role', p_role), null, null, null, '{}'::jsonb);
end $$;

revoke all on function public.lead_create(jsonb) from public, anon;
grant execute on function public.lead_create(jsonb) to authenticated;
revoke all on function public.lead_update(uuid,jsonb) from public, anon;
grant execute on function public.lead_update(uuid,jsonb) to authenticated;
revoke all on function public.lead_log_call(uuid,text,text,timestamptz) from public, anon;
grant execute on function public.lead_log_call(uuid,text,text,timestamptz) to authenticated;
revoke all on function public.lead_add_note(uuid,text) from public, anon;
grant execute on function public.lead_add_note(uuid,text) to authenticated;
revoke all on function public.lead_mark_good(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.lead_mark_good(uuid,text,text,text,text,text) to authenticated;
revoke all on function public.lead_mark_lost(uuid,text,text) from public, anon;
grant execute on function public.lead_mark_lost(uuid,text,text) to authenticated;
revoke all on function public.lead_reopen(uuid,text) from public, anon;
grant execute on function public.lead_reopen(uuid,text) to authenticated;
revoke all on function public.lead_assign(uuid,uuid) from public, anon;
grant execute on function public.lead_assign(uuid,uuid) to authenticated;
revoke all on function public.lead_take(uuid) from public, anon;
grant execute on function public.lead_take(uuid) to authenticated;
revoke all on function public.lead_mark_won(uuid,uuid) from public, anon;
grant execute on function public.lead_mark_won(uuid,uuid) to authenticated;
revoke all on function public.lead_visit_start(uuid,double precision,double precision,double precision) from public, anon;
grant execute on function public.lead_visit_start(uuid,double precision,double precision,double precision) to authenticated;
revoke all on function public.lead_visit_end(uuid,double precision,double precision,double precision,text,text,timestamptz) from public, anon;
grant execute on function public.lead_visit_end(uuid,double precision,double precision,double precision,text,text,timestamptz) to authenticated;
revoke all on function public.lead_import(jsonb,uuid,text) from public, anon;
grant execute on function public.lead_import(jsonb,uuid,text) to authenticated;
revoke all on function public.set_sales_role(uuid,text) from public, anon;
grant execute on function public.set_sales_role(uuid,text) to authenticated;
grant execute on function private.can_work_lead(uuid), private.is_sales_employee(uuid),
  private.norm_phone(text), private.norm_email(text), private.clean(text,int) to authenticated;
