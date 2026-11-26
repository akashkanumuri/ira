-- Performance Marketing, part 2: actions (setup, posts, campaigns, results, reports, ad money) and file access.

create or replace function private.mk_notify_team(p_client uuid, p_title text, p_msg text, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select distinct e.profile_id from public.mk_team t join public.employees e on e.id = t.employee_id
           where t.client_id = p_client and e.status = 'active' and e.profile_id is not null loop
    if r.profile_id is distinct from auth.uid() then
      perform private.notify(r.profile_id, 'marketing', p_title, p_msg, '/emp-marketing', p_key || ':' || r.profile_id, '{}'::jsonb);
    end if;
  end loop;
end $$;

create or replace function private.mk_notify_client(p_client uuid, p_title text, p_msg text, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.mk_clients where client_id = p_client and enabled and client_access) then
    perform private.notify_client(p_client, 'marketing', p_title, p_msg, '/client/marketing', p_key);
  end if;
end $$;

create or replace function private.mk_require_work(p_client uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(p_client is not null and private.mk_can_work(p_client), 'You are not on the marketing team for this client');
end $$;

-- ---------------------------------------------------------------- setup
create or replace function public.mk_client_save(p_client uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.has_permission('marketing.manage') and not private.offer_locked(), 'Only an admin can set up marketing');
  perform private.require(exists (select 1 from public.clients where id = p_client and deleted_at is null), 'Client not found');
  insert into public.mk_clients (client_id, enabled, client_access, post_approval, low_balance, updated_by)
  values (p_client, coalesce((p->>'enabled')::boolean, true), coalesce((p->>'client_access')::boolean, false),
          coalesce((p->>'post_approval')::boolean, false), greatest(0, coalesce(nullif(p->>'low_balance', '')::numeric, 0)), auth.uid())
  on conflict (client_id) do update set
    enabled = coalesce((p->>'enabled')::boolean, public.mk_clients.enabled),
    client_access = coalesce((p->>'client_access')::boolean, public.mk_clients.client_access),
    post_approval = coalesce((p->>'post_approval')::boolean, public.mk_clients.post_approval),
    low_balance = greatest(0, coalesce(nullif(p->>'low_balance', '')::numeric, public.mk_clients.low_balance)),
    updated_by = auth.uid(), updated_at = now();
  perform private.audit('mk_client', p_client::text, 'save', p, null, p_client, null, '{}'::jsonb);
end $$;

create or replace function public.mk_team_set(p_client uuid, p_employees uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.require(private.has_permission('marketing.manage') and not private.offer_locked(), 'Only an admin can change the marketing team');
  perform private.require(exists (select 1 from public.mk_clients where client_id = p_client), 'Set up marketing for this client first');
  perform private.require(coalesce(cardinality(p_employees), 0) <= 30, 'Up to 30 people per client');
  perform private.require(not exists (select 1 from unnest(coalesce(p_employees, '{}')) x
    where not exists (select 1 from public.employees e where e.id = x and e.status = 'active')), 'Pick active employees only');
  delete from public.mk_team where client_id = p_client and not (employee_id = any(coalesce(p_employees, '{}')));
  insert into public.mk_team (client_id, employee_id, added_by)
  select p_client, x, auth.uid() from unnest(coalesce(p_employees, '{}')) x on conflict do nothing;
  select count(*) into n from public.mk_team where client_id = p_client;
  perform private.mk_notify_team(p_client, 'Marketing: ' || (select company_name from public.clients where id = p_client),
    'You are on the marketing team for this client.', 'mk-team:' || p_client);
  perform private.audit('mk_team', p_client::text, 'set', jsonb_build_object('employees', p_employees), null, p_client, null, '{}'::jsonb);
  return n;
end $$;

-- ---------------------------------------------------------------- posts
create or replace function public.mk_post_save(p_id uuid, p_client uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.mk_posts; v_client uuid := p_client; v_platforms text[]; v_id uuid;
begin
  if p_id is not null then
    select * into r from public.mk_posts where id = p_id for update;
    perform private.require(found, 'Post not found');
    v_client := r.client_id;
  end if;
  perform private.mk_require_work(v_client);
  select coalesce(array_agg(distinct x), '{}') into v_platforms from jsonb_array_elements_text(coalesce(p->'platforms', '[]'::jsonb)) x;
  perform private.require(cardinality(v_platforms) between 1 and 6, 'Pick at least one platform');
  perform private.require(nullif(p->>'scheduled_for', '') is not null, 'Pick the date and time');
  if p_id is null then
    insert into public.mk_posts (client_id, platforms, post_type, scheduled_for, title, caption, created_by)
    values (v_client, v_platforms, coalesce(nullif(p->>'post_type', ''), 'post'), (p->>'scheduled_for')::timestamptz,
            private.clean(p->>'title', 160), private.clean(p->>'caption', 5000), auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  perform private.require(r.status in ('draft','changes_requested','approved'), 'A posted or cancelled post can no longer be edited');
  update public.mk_posts set platforms = v_platforms, post_type = coalesce(nullif(p->>'post_type', ''), post_type),
    scheduled_for = (p->>'scheduled_for')::timestamptz, title = private.clean(p->>'title', 160), caption = private.clean(p->>'caption', 5000),
    -- an approved post that is edited needs approval again
    status = case when status = 'approved' and (select post_approval from public.mk_clients where client_id = v_client)
                   and (caption is distinct from private.clean(p->>'caption', 5000) or scheduled_for is distinct from (p->>'scheduled_for')::timestamptz)
                  then 'draft' else status end,
    updated_at = now()
  where id = r.id;
  return r.id;
end $$;

create or replace function public.mk_post_action(p_id uuid, p_action text, p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.mk_posts; v_approval boolean; v_to text; v_url text; v_note text := private.clean(p->>'note', 2000);
  v_when text;
begin
  select * into r from public.mk_posts where id = p_id for update;
  perform private.require(found, 'Post not found');
  select post_approval into v_approval from public.mk_clients where client_id = r.client_id;
  v_when := to_char(r.scheduled_for at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM');
  if p_action in ('approve','changes') then
    perform private.require(private.mk_client_sees(r.client_id) and private.has_permission('client.deliverable.review'),
      'Your account is not allowed to approve posts');
    perform private.require(r.status = 'awaiting_approval', 'This post is not waiting for your approval');
    if p_action = 'approve' then
      update public.mk_posts set status = 'approved', client_note = v_note, updated_at = now() where id = r.id;
      perform private.mk_notify_team(r.client_id, 'Post approved', coalesce(r.title, 'Post') || ' for ' || v_when || ' was approved.', 'mk-post-ok:' || r.id);
    else
      perform private.require(v_note is not null, 'Tell the team what to change');
      update public.mk_posts set status = 'changes_requested', client_note = v_note, updated_at = now() where id = r.id;
      perform private.mk_notify_team(r.client_id, 'Changes asked on a post', left(v_note, 200), 'mk-post-chg:' || r.id || ':' || md5(v_note));
      perform private.notify_admins('marketing', 'Changes asked on a post', left(v_note, 200), '/admin-marketing', 'mk-post-chg:' || r.id || ':' || md5(v_note));
    end if;
    return p_action;
  end if;

  perform private.mk_require_work(r.client_id);
  case p_action
    when 'submit' then
      perform private.require(r.status in ('draft','changes_requested'), 'Only a draft can be sent');
      v_to := case when coalesce(v_approval, false) then 'awaiting_approval' else 'approved' end;
      update public.mk_posts set status = v_to, updated_at = now() where id = r.id;
      if v_to = 'awaiting_approval' then
        perform private.mk_notify_client(r.client_id, 'Post ready for your approval', coalesce(r.title, 'A post') || ' planned for ' || v_when || '.', 'mk-post-ask:' || r.id || ':' || extract(epoch from now())::bigint);
      end if;
    when 'posted' then
      perform private.require(r.status = 'approved' or (r.status = 'draft' and not coalesce(v_approval, false)),
        case when coalesce(v_approval, false) then 'The client has to approve this post first' else 'This post cannot be marked as posted' end);
      v_url := nullif(btrim(coalesce(p->>'live_url', '')), '');
      perform private.require(v_url is null or (v_url ~* '^https://' and length(v_url) <= 600), 'Paste the full https:// link of the live post');
      update public.mk_posts set status = 'posted', live_url = v_url, posted_at = now(), updated_at = now() where id = r.id;
    when 'metrics' then
      perform private.require(r.status = 'posted', 'Add numbers after the post is live');
      v_url := nullif(btrim(coalesce(p->>'live_url', '')), '');
      perform private.require(v_url is null or (v_url ~* '^https://' and length(v_url) <= 600), 'Paste the full https:// link of the live post');
      update public.mk_posts set live_url = coalesce(v_url, live_url),
        reach = nullif(p->>'reach', '')::int, likes = nullif(p->>'likes', '')::int, comments = nullif(p->>'comments', '')::int,
        shares = nullif(p->>'shares', '')::int, updated_at = now() where id = r.id;
    when 'cancel' then
      perform private.require(r.status <> 'posted', 'A posted post cannot be cancelled');
      update public.mk_posts set status = 'cancelled', updated_at = now() where id = r.id;
    when 'restore' then
      perform private.require(r.status = 'cancelled', 'Only a cancelled post can be restored');
      update public.mk_posts set status = 'draft', updated_at = now() where id = r.id;
    else
      perform private.require(false, 'Unknown action');
  end case;
  return p_action;
end $$;

-- ---------------------------------------------------------------- campaigns and results
create or replace function public.mk_campaign_save(p_id uuid, p_client uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.mk_campaigns; v_client uuid := p_client; v_id uuid;
begin
  if p_id is not null then
    select * into r from public.mk_campaigns where id = p_id for update;
    perform private.require(found, 'Campaign not found');
    v_client := r.client_id;
  end if;
  perform private.mk_require_work(v_client);
  perform private.require(length(btrim(coalesce(p->>'name', ''))) between 1 and 160, 'Name the campaign');
  perform private.require(nullif(p->>'start_date', '') is not null, 'Pick a start date');
  if p_id is null then
    insert into public.mk_campaigns (client_id, name, platform, objective, start_date, end_date, budget, status, notes, created_by)
    values (v_client, btrim(p->>'name'), p->>'platform', coalesce(nullif(p->>'objective', ''), 'leads'), (p->>'start_date')::date,
            nullif(p->>'end_date', '')::date, nullif(p->>'budget', '')::numeric, coalesce(nullif(p->>'status', ''), 'running'),
            private.clean(p->>'notes', 2000), auth.uid())
    returning id into v_id;
    perform private.mk_notify_client(v_client, 'New ad campaign', btrim(p->>'name') || ' was added.', 'mk-camp:' || v_id);
    return v_id;
  end if;
  update public.mk_campaigns set name = btrim(p->>'name'), platform = p->>'platform', objective = coalesce(nullif(p->>'objective', ''), objective),
    start_date = (p->>'start_date')::date, end_date = nullif(p->>'end_date', '')::date, budget = nullif(p->>'budget', '')::numeric,
    status = coalesce(nullif(p->>'status', ''), status), notes = private.clean(p->>'notes', 2000), updated_at = now()
  where id = r.id;
  return r.id;
end $$;

-- Add or overwrite daily results for one campaign (one row per day). Rows: [{day, spend, impressions, reach, clicks, leads, messages, sales, sales_value}]
create or replace function public.mk_results_save(p_campaign uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare c public.mk_campaigns; e jsonb; n int := 0; v_day date; m public.mk_clients;
  v_received numeric; v_spent numeric; v_before numeric;
begin
  select * into c from public.mk_campaigns where id = p_campaign;
  perform private.require(found, 'Campaign not found');
  perform private.mk_require_work(c.client_id);
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 1 and 400, 'Add between 1 and 400 days');
  select coalesce(sum(spend), 0) into v_before from public.mk_results where client_id = c.client_id;
  for e in select value from jsonb_array_elements(p_rows) loop
    v_day := (e->>'day')::date;
    perform private.require(v_day is not null and v_day <= private.today_ist() and v_day >= c.start_date - 1,
      'Each day must be between the campaign start and today');
    insert into public.mk_results (campaign_id, client_id, day, spend, impressions, reach, clicks, leads, messages, sales, sales_value, updated_by)
    values (c.id, c.client_id, v_day, coalesce(nullif(e->>'spend', '')::numeric, 0), coalesce(nullif(e->>'impressions', '')::numeric, 0)::bigint,
      coalesce(nullif(e->>'reach', '')::numeric, 0)::bigint, coalesce(nullif(e->>'clicks', '')::numeric, 0)::bigint,
      coalesce(nullif(e->>'leads', '')::numeric, 0)::int, coalesce(nullif(e->>'messages', '')::numeric, 0)::int,
      coalesce(nullif(e->>'sales', '')::numeric, 0)::int, coalesce(nullif(e->>'sales_value', '')::numeric, 0), auth.uid())
    on conflict (campaign_id, day) do update set spend = excluded.spend, impressions = excluded.impressions, reach = excluded.reach,
      clicks = excluded.clicks, leads = excluded.leads, messages = excluded.messages, sales = excluded.sales,
      sales_value = excluded.sales_value, updated_by = auth.uid(), updated_at = now();
    n := n + 1;
  end loop;
  -- low-balance alert when this update takes the ad balance under the client's threshold
  select * into m from public.mk_clients where client_id = c.client_id;
  if m.low_balance > 0 then
    select coalesce(sum(case kind when 'receipt' then amount when 'refund' then -amount when 'adjustment' then amount else 0 end), 0)
      into v_received from public.mk_money where client_id = c.client_id and voided_at is null;
    select coalesce(sum(spend), 0) into v_spent from public.mk_results where client_id = c.client_id;
    if v_received - v_spent < m.low_balance and v_received - v_before >= m.low_balance then
      perform private.notify_admins('marketing', 'Ad balance running low',
        (select company_name from public.clients where id = c.client_id) || ': ₹' || to_char(greatest(v_received - v_spent, 0), 'FM99,99,99,990') || ' left.',
        '/admin-marketing', 'mk-low:' || c.client_id || ':' || private.today_ist());
      perform private.mk_notify_client(c.client_id, 'Ad budget running low',
        '₹' || to_char(greatest(v_received - v_spent, 0), 'FM99,99,99,990') || ' left for ads. Top up to keep campaigns running.', 'mk-low:' || c.client_id || ':' || private.today_ist());
    end if;
  end if;
  return n;
end $$;

create or replace function public.mk_results_remove(p_campaign uuid, p_day date) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.mk_campaigns;
begin
  select * into c from public.mk_campaigns where id = p_campaign;
  perform private.require(found, 'Campaign not found');
  perform private.mk_require_work(c.client_id);
  delete from public.mk_results where campaign_id = c.id and day = p_day;
  perform private.audit('mk_results', c.id::text, 'remove_day', jsonb_build_object('day', p_day), null, c.client_id, null, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------- reports
create or replace function public.mk_report_save(p_id uuid, p_client uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.mk_reports; v_client uuid := p_client; v_id uuid;
begin
  if p_id is not null then
    select * into r from public.mk_reports where id = p_id for update;
    perform private.require(found, 'Report not found');
    v_client := r.client_id;
  end if;
  perform private.mk_require_work(v_client);
  if coalesce((p->>'archive')::boolean, false) and p_id is not null then
    update public.mk_reports set archived_at = now() where id = r.id;
    return r.id;
  end if;
  perform private.require(length(btrim(coalesce(p->>'title', ''))) between 1 and 160, 'Give the report a title');
  if p_id is null then
    insert into public.mk_reports (client_id, title, period_start, period_end, visible_to_client, created_by)
    values (v_client, btrim(p->>'title'), nullif(p->>'period_start', '')::date, nullif(p->>'period_end', '')::date,
            coalesce((p->>'visible_to_client')::boolean, true), auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  update public.mk_reports set title = btrim(p->>'title'), period_start = nullif(p->>'period_start', '')::date,
    period_end = nullif(p->>'period_end', '')::date, visible_to_client = coalesce((p->>'visible_to_client')::boolean, visible_to_client)
  where id = r.id;
  return r.id;
end $$;

-- Tell the client once the file is attached (called by the app after the upload succeeds).
create or replace function public.mk_report_publish(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.mk_reports;
begin
  select * into r from public.mk_reports where id = p_id;
  perform private.require(found, 'Report not found');
  perform private.mk_require_work(r.client_id);
  perform private.require(exists (select 1 from public.files where parent_type = 'mk_report' and parent_id = r.id and deleted_at is null), 'Attach the report file first');
  if r.visible_to_client and r.archived_at is null then
    perform private.mk_notify_client(r.client_id, 'New marketing report', r.title || ' is ready to view.', 'mk-report:' || r.id);
  end if;
end $$;

-- ---------------------------------------------------------------- ad money
create or replace function public.mk_money_add(p_client uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_kind text := p->>'kind'; v_amount numeric := nullif(p->>'amount', '')::numeric; v_req uuid := nullif(p->>'request_id', '')::uuid;
  v_id uuid; v_date date := coalesce(nullif(p->>'entry_date', '')::date, private.today_ist()); v_ref text := private.clean(p->>'reference', 120);
begin
  perform private.require(private.has_permission('marketing.manage') and not private.offer_locked(), 'Only an admin can record ad money');
  perform private.require(exists (select 1 from public.mk_clients where client_id = p_client), 'Set up marketing for this client first');
  perform private.require(v_kind in ('request','receipt','refund','adjustment'), 'Pick what you are recording');
  perform private.require(v_amount is not null and abs(v_amount) <= 100000000 and (v_amount > 0 or (v_kind = 'adjustment' and v_amount <> 0)), 'Enter a valid amount');
  perform private.require(v_date <= private.today_ist() + 1, 'The date cannot be in the future');
  perform private.require(v_kind <> 'adjustment' or private.clean(p->>'note', 600) is not null, 'Say why you are adjusting the balance');
  if v_req is not null then
    perform private.require(v_kind = 'receipt' and exists (select 1 from public.mk_money where id = v_req and client_id = p_client and kind = 'request' and voided_at is null),
      'Pick an open request from this client');
  end if;
  perform private.require(v_ref is null or v_kind not in ('receipt','refund') or not exists (select 1 from public.mk_money where client_id = p_client
    and kind = v_kind and lower(reference) = lower(v_ref) and voided_at is null), 'This reference is already recorded');
  insert into public.mk_money (client_id, kind, amount, entry_date, due_date, request_id, method, reference, note, created_by)
  values (p_client, v_kind, v_amount, v_date, case when v_kind = 'request' then nullif(p->>'due_date', '')::date end, v_req,
          case when v_kind in ('receipt','refund') then nullif(p->>'method', '') end, v_ref, private.clean(p->>'note', 600), auth.uid())
  returning id into v_id;
  if v_kind = 'request' then
    perform private.mk_notify_client(p_client, 'Ad budget requested', '₹' || to_char(v_amount, 'FM99,99,99,990') || ' for ads' ||
      coalesce(', due by ' || to_char(nullif(p->>'due_date', '')::date, 'DD Mon YYYY'), '') || '.', 'mk-req:' || v_id);
  elsif v_kind = 'receipt' then
    perform private.mk_notify_client(p_client, 'Ad budget received', '₹' || to_char(v_amount, 'FM99,99,99,990') || ' added to your ad balance. Thank you!', 'mk-rcpt:' || v_id);
  end if;
  perform private.audit('mk_money', v_id::text, v_kind, jsonb_build_object('amount', v_amount, 'reference', v_ref), private.clean(p->>'note', 600), p_client, null, '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.mk_money_void(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.mk_money; v_reason text := private.clean(p_reason, 400);
begin
  perform private.require(private.has_permission('marketing.manage') and not private.offer_locked(), 'Only an admin can void an entry');
  select * into r from public.mk_money where id = p_id for update;
  perform private.require(found and r.voided_at is null, 'Entry not found or already voided');
  perform private.require(v_reason is not null, 'Give a reason');
  perform private.require(not exists (select 1 from public.mk_money where request_id = r.id and voided_at is null), 'Void the payments against this request first');
  update public.mk_money set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = r.id;
  perform private.audit('mk_money', r.id::text, 'void', jsonb_build_object('kind', r.kind, 'amount', r.amount), v_reason, r.client_id, null, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------- grants
do $g$
declare f text;
begin
  foreach f in array array[
    'public.mk_client_save(uuid, jsonb)', 'public.mk_team_set(uuid, uuid[])', 'public.mk_post_save(uuid, uuid, jsonb)',
    'public.mk_post_action(uuid, text, jsonb)', 'public.mk_campaign_save(uuid, uuid, jsonb)', 'public.mk_results_save(uuid, jsonb)',
    'public.mk_results_remove(uuid, date)', 'public.mk_report_save(uuid, uuid, jsonb)', 'public.mk_report_publish(uuid)',
    'public.mk_money_add(uuid, jsonb)', 'public.mk_money_void(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;
revoke all on function private.mk_notify_team(uuid, text, text, text), private.mk_notify_client(uuid, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------- files on posts (creatives) and reports
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.attach_file(text,text,uuid,text,text,bigint,text,boolean,uuid)'::regprocedure);
  if position('mk_post' in d) = 0 then
    n := replace(d, $a$    when 'leave' then$a$, $a$    when 'mk_post' then
      select null::uuid, x.client_id into v_project, v_client from public.mk_posts x where x.id = p_parent_id and x.status not in ('posted','cancelled');
      v_allowed := v_client is not null and private.mk_can_work(v_client);
      p_visibility := 'client'; p_is_final := false;
    when 'mk_report' then
      select null::uuid, x.client_id into v_project, v_client from public.mk_reports x where x.id = p_parent_id and x.archived_at is null;
      v_allowed := v_client is not null and private.mk_can_work(v_client);
      p_visibility := 'client'; p_is_final := false;
    when 'leave' then$a$);
    if n = d then raise exception 'attach_file: anchor not found'; end if;
    execute n;
  end if;

  d := pg_get_functiondef('private.can_read_file(uuid)'::regprocedure);
  if position('mk_post' in d) = 0 then
    n := replace(d, $a$  if f.parent_type = 'service_request' and private.current_client_id() is null$a$,
      $a$  if f.parent_type in ('mk_post','mk_report') and f.client_id is not null and private.mk_can_work(f.client_id) then return true; end if;
  if f.parent_type = 'service_request' and private.current_client_id() is null$a$);
    n := replace(n, $a$    when 'service_request' then$a$, $a$    when 'mk_post' then
      return private.mk_client_sees(f.client_id) and exists (select 1 from public.mk_posts x where x.id = f.parent_id and x.status not in ('draft','cancelled'));
    when 'mk_report' then
      return private.mk_client_sees(f.client_id) and exists (select 1 from public.mk_reports x where x.id = f.parent_id and x.visible_to_client and x.archived_at is null);
    when 'service_request' then$a$);
    if (length(n) - length(replace(n, 'mk_post', ''))) / 7 < 3 then raise exception 'can_read_file: anchor not found'; end if;
    execute n;
  end if;
end $mig$;
