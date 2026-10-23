-- SIGMA 1 — deliverable discussion (spec 10) and client help / support requests (spec 52)
--
-- Additive: new tables and functions only.
--
--   deliverable_comments  a thread on each deliverable. Staff can post client-visible replies or
--                         internal notes; clients only ever see client-visible comments on
--                         deliverables they can already see (never drafts).
--   support_requests      a client raises a question or problem (optionally about a project)
--   support_messages      the conversation on a request; staff can add internal notes

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- deliverable comments
create table if not exists public.deliverable_comments (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  author_id uuid references public.profiles(id) on delete set null,
  author_kind text not null check (author_kind in ('client','staff')),
  author_name text,
  body text not null check (length(btrim(body)) between 1 and 4000),
  visibility text not null default 'client' check (visibility in ('client','internal')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (author_kind = 'staff' or visibility = 'client')
);
create index if not exists deliverable_comments_deliverable_idx on public.deliverable_comments(deliverable_id, created_at);
alter table public.deliverable_comments enable row level security;

-- Staff who work on this deliverable: admins / project.manage_all, the project's managers, or the responsible employee.
create or replace function private.is_deliverable_staff(p_deliverable_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.deliverables d where d.id = p_deliverable_id
                 and (private.can_manage_project(d.project_id) or d.responsible_id = private.current_employee_id()))
$$;

-- A client user of this deliverable's client, who may see it (not a draft, not deleted).
create or replace function private.is_deliverable_client(p_deliverable_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.deliverables d where d.id = p_deliverable_id
                 and d.deleted_at is null and d.status <> 'Draft'
                 and private.is_client_of_project(d.project_id)
                 and private.has_permission('client.deliverable.view'))
$$;

create or replace function public.deliverable_add_comment(p_deliverable_id uuid, p_body text, p_internal boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.deliverables; v_id uuid; v_body text := btrim(coalesce(p_body, '')); v_staff boolean; v_client boolean;
  v_name text; v_kind text; v_vis text; v_resp uuid;
begin
  select * into d from public.deliverables where id = p_deliverable_id and deleted_at is null;
  perform private.require(found, 'Deliverable not found');
  v_staff := private.current_client_id() is null and private.is_deliverable_staff(d.id);
  v_client := private.is_deliverable_client(d.id);
  perform private.require(v_staff or v_client, 'You can’t comment on this deliverable');
  perform private.require(length(v_body) between 1 and 4000, 'Write a comment (up to 4000 characters)');
  v_kind := case when v_staff then 'staff' else 'client' end;
  v_vis := case when v_staff and coalesce(p_internal, false) then 'internal' else 'client' end;
  if v_staff then
    select coalesce(e.name, 'IRA team') into v_name from public.employees e where e.profile_id = auth.uid();
    v_name := coalesce(v_name, 'IRA team');
  else
    select coalesce(cu.full_name, c.company_name) into v_name from public.client_users cu join public.clients c on c.id = cu.client_id
    where cu.profile_id = auth.uid() limit 1;
  end if;
  insert into public.deliverable_comments(deliverable_id, project_id, client_id, author_id, author_kind, author_name, body, visibility)
  values (d.id, d.project_id, d.client_id, auth.uid(), v_kind, v_name, v_body, v_vis)
  returning id into v_id;

  if v_kind = 'client' then
    perform private.notify_project_staff(d.project_id, 'deliverable', 'Client comment on ' || d.name,
      coalesce(v_name, 'The client') || ': ' || left(v_body, 160), '/admin-clients?project=' || d.project_id || '&view=deliverables', 'dcomment_' || v_id);
    if d.responsible_id is not null then
      perform private.notify_employee(d.responsible_id, 'deliverable', 'Client comment on ' || d.name,
        coalesce(v_name, 'The client') || ': ' || left(v_body, 160), '/emp-client-work', 'dcomment_' || v_id);
    end if;
  elsif v_vis = 'client' and d.client_id is not null then
    perform private.notify_client(d.client_id, 'deliverable', 'New comment on ' || d.name, left(v_body, 160), '/client/deliverables', 'dcomment_' || v_id);
  end if;
  return v_id;
end $$;

drop policy if exists deliverable_comments_select on public.deliverable_comments;
create policy deliverable_comments_select on public.deliverable_comments for select to authenticated
  using (deleted_at is null and (
    (private.current_client_id() is null and private.is_deliverable_staff(deliverable_id))
    or (visibility = 'client' and private.is_deliverable_client(deliverable_id))));

-- ---------------------------------------------------------------- support requests
create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text unique,
  client_id uuid not null references public.clients(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  subject text not null check (length(btrim(subject)) between 3 and 160),
  category text not null default 'question' check (category in ('question','problem','billing','access','feedback')),
  status text not null default 'open' check (status in ('open','in_progress','waiting_on_client','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references public.employees(id) on delete set null,
  last_message_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_requests_client_idx on public.support_requests(client_id, last_message_at desc);
create index if not exists support_requests_open_idx on public.support_requests(status) where status not in ('resolved','closed');

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.support_requests(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_kind text not null check (author_kind in ('client','staff')),
  author_name text,
  body text not null check (length(btrim(body)) between 1 and 4000),
  internal boolean not null default false,
  created_at timestamptz not null default now(),
  check (author_kind = 'staff' or not internal)
);
create index if not exists support_messages_request_idx on public.support_messages(request_id, created_at);

alter table public.support_requests enable row level security;
alter table public.support_messages enable row level security;

create sequence if not exists public.support_request_seq;

-- Staff who handle a request: admins / client.edit, the managers of its project, or the assignee.
create or replace function private.is_support_staff(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_client_id() is null and exists (
    select 1 from public.support_requests r where r.id = p_request_id
      and (private.is_admin() or private.has_permission('client.edit')
           or r.assigned_to = private.current_employee_id()
           or (r.project_id is not null and private.is_project_manager(r.project_id))))
$$;

create or replace function public.support_create(p_subject text, p_body text, p_category text default 'question', p_project_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_client uuid := private.current_client_id(); v_id uuid; v_no text; v_name text;
begin
  perform private.require(v_client is not null, 'Only client users can open a support request');
  perform private.require(length(btrim(coalesce(p_subject, ''))) between 3 and 160, 'Add a short subject');
  perform private.require(length(btrim(coalesce(p_body, ''))) between 1 and 4000, 'Describe what you need (up to 4000 characters)');
  perform private.require(coalesce(p_category, 'question') in ('question','problem','billing','access','feedback'), 'Choose a category');
  perform private.require(p_project_id is null or private.is_client_of_project(p_project_id), 'Project not found');
  v_no := 'SR-' || lpad(nextval('public.support_request_seq')::text, 5, '0');
  select coalesce(cu.full_name, c.company_name) into v_name from public.client_users cu join public.clients c on c.id = cu.client_id
  where cu.profile_id = auth.uid() limit 1;
  insert into public.support_requests(request_number, client_id, project_id, created_by, subject, category, priority)
  values (v_no, v_client, p_project_id, auth.uid(), btrim(p_subject), coalesce(p_category, 'question'),
          case when p_category = 'problem' then 'high' else 'normal' end)
  returning id into v_id;
  insert into public.support_messages(request_id, author_id, author_kind, author_name, body)
  values (v_id, auth.uid(), 'client', v_name, btrim(p_body));
  -- Admins always; the project's managers too when a project is chosen.
  perform private.notify_project_staff(p_project_id, 'client', 'Support request ' || v_no, coalesce(v_name, 'A client') || ': ' || btrim(p_subject),
    '/admin-support?request=' || v_id, 'support_new_' || v_id);
  return v_id;
end $$;

create or replace function public.support_reply(p_request_id uuid, p_body text, p_internal boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.support_requests; v_staff boolean; v_client boolean; v_id uuid; v_name text; v_internal boolean;
begin
  select * into r from public.support_requests where id = p_request_id for update;
  perform private.require(found, 'Request not found');
  v_staff := private.is_support_staff(r.id);
  v_client := coalesce(private.current_client_id() = r.client_id, false);
  perform private.require(v_staff or v_client, 'Request not found');
  perform private.require(r.status <> 'closed', 'This request is closed — open a new one');
  perform private.require(length(btrim(coalesce(p_body, ''))) between 1 and 4000, 'Write a message (up to 4000 characters)');
  v_internal := v_staff and coalesce(p_internal, false);
  if v_staff then
    select coalesce(e.name, 'IRA team') into v_name from public.employees e where e.profile_id = auth.uid();
    v_name := coalesce(v_name, 'IRA team');
  else
    select coalesce(cu.full_name, c.company_name) into v_name from public.client_users cu join public.clients c on c.id = cu.client_id
    where cu.profile_id = auth.uid() limit 1;
  end if;
  insert into public.support_messages(request_id, author_id, author_kind, author_name, body, internal)
  values (r.id, auth.uid(), case when v_staff then 'staff' else 'client' end, v_name, btrim(p_body), v_internal)
  returning id into v_id;
  if not v_internal then
    update public.support_requests set last_message_at = now(), updated_at = now(),
      status = case when v_staff and status in ('open','resolved') then 'in_progress'
                    when v_client and status in ('waiting_on_client','resolved') then 'open' else status end,
      resolved_at = case when v_client and status = 'resolved' then null else resolved_at end
    where id = r.id;
    if v_staff then
      perform private.notify_client(r.client_id, 'client', 'Reply on ' || r.request_number, left(btrim(p_body), 160), '/client/support', 'support_msg_' || v_id);
    else
      perform private.notify_project_staff(r.project_id, 'client', 'Client replied on ' || r.request_number, left(btrim(p_body), 160),
        '/admin-support?request=' || r.id, 'support_msg_' || v_id);
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.support_set_status(p_request_id uuid, p_status text, p_assigned_to uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.support_requests; v_client boolean;
begin
  select * into r from public.support_requests where id = p_request_id for update;
  perform private.require(found, 'Request not found');
  v_client := coalesce(private.current_client_id() = r.client_id, false);
  perform private.require(private.is_support_staff(r.id) or (v_client and p_status in ('resolved','closed')), 'Not allowed');
  perform private.require(p_status in ('open','in_progress','waiting_on_client','resolved','closed'), 'Unknown status');
  perform private.require(p_assigned_to is null or not v_client, 'Not allowed');
  perform private.require(p_assigned_to is null or exists (select 1 from public.employees e where e.id = p_assigned_to and e.status = 'active'), 'Pick an active employee');
  update public.support_requests set status = p_status, updated_at = now(),
    assigned_to = coalesce(p_assigned_to, assigned_to),
    resolved_at = case when p_status in ('resolved','closed') then coalesce(resolved_at, now()) else null end
  where id = r.id;
  if not v_client and p_status = 'resolved' then
    perform private.notify_client(r.client_id, 'client', r.request_number || ' resolved', r.subject || ' was marked resolved. Reply if you still need help.',
      '/client/support', 'support_resolved_' || r.id || '_' || extract(epoch from now())::bigint);
  end if;
  if p_assigned_to is not null and p_assigned_to is distinct from r.assigned_to then
    perform private.notify_employee(p_assigned_to, 'client', 'Support request assigned to you', r.request_number || ': ' || r.subject,
      '/admin-support?request=' || r.id, 'support_assign_' || r.id || '_' || p_assigned_to);
  end if;
end $$;

drop policy if exists support_requests_select on public.support_requests;
create policy support_requests_select on public.support_requests for select to authenticated
  using (client_id = private.current_client_id() or private.is_support_staff(id));
drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select on public.support_messages for select to authenticated
  using ((not internal and exists (select 1 from public.support_requests r where r.id = request_id and r.client_id = private.current_client_id()))
      or private.is_support_staff(request_id));

create or replace trigger trg_audit_support_requests after insert or update or delete on public.support_requests for each row execute function private.audit_row_change();
create or replace trigger trg_audit_deliverable_comments after insert or update or delete on public.deliverable_comments for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------- grants
revoke all on public.deliverable_comments, public.support_requests, public.support_messages from anon;
revoke insert, update, delete, truncate, trigger, references on public.deliverable_comments, public.support_requests, public.support_messages from authenticated;
grant select on public.deliverable_comments, public.support_requests, public.support_messages to authenticated;
revoke all on sequence public.support_request_seq from anon, authenticated;

revoke execute on function private.is_deliverable_staff(uuid), private.is_deliverable_client(uuid), private.is_support_staff(uuid) from public, anon;
grant execute on function private.is_deliverable_staff(uuid), private.is_deliverable_client(uuid), private.is_support_staff(uuid) to authenticated;
revoke execute on function public.deliverable_add_comment(uuid, text, boolean), public.support_create(text, text, text, uuid),
  public.support_reply(uuid, text, boolean), public.support_set_status(uuid, text, uuid) from public, anon;
grant execute on function public.deliverable_add_comment(uuid, text, boolean), public.support_create(text, text, text, uuid),
  public.support_reply(uuid, text, boolean), public.support_set_status(uuid, text, uuid) to authenticated;
