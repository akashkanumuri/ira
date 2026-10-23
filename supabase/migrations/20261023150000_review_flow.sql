-- SIGMA 1 — draft-by-draft review, time tracking and the client review loop
--
-- Requires 20261023100000_task_workflow and 20261023130000_client_collaboration.
-- Additive: new tables/columns, and replaced functions keep their signatures.
--
--   Employee ⇄ manager/admin (internal)            Manager/admin ⇄ client (external)
--   ─────────────────────────────────              ─────────────────────────────────
--   task_drafts: Draft 1, 2, 3… each a link,       deliverable_client_reviews: Version 1, 2…
--   reviewed: approved / changes requested         sent by "IRA team", client approves or asks
--                                                  for changes; manager forwards feedback to
--                                                  the employee as a new internal round.
--
-- Clients never see employee or manager names, internal drafts or internal comments.
-- Work is shared as links only (no file storage).

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- tasks: estimate + drafts + timer
alter table public.tasks add column if not exists estimate_minutes integer;
do $$ begin
  alter table public.tasks add constraint tasks_estimate_check check (estimate_minutes is null or estimate_minutes between 1 and 100000);
exception when duplicate_object then null; end $$;

create table if not exists public.task_drafts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  draft_no integer not null check (draft_no > 0),
  link text not null check (link ~* '^https?://' and length(link) <= 2000),
  note text check (note is null or length(note) <= 2000),
  submitted_by uuid references public.employees(id) on delete set null,
  submitted_at timestamptz not null default now(),
  on_time boolean,
  decision text not null default 'pending' check (decision in ('pending','approved','changes_requested','auto_approved')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  feedback text check (feedback is null or length(feedback) <= 2000),
  unique (task_id, draft_no)
);
create index if not exists task_drafts_task_idx on public.task_drafts(task_id, draft_no);
create index if not exists task_drafts_submitter_idx on public.task_drafts(submitted_by, submitted_at);
alter table public.task_drafts enable row level security;

create table if not exists public.task_timers (
  employee_id uuid primary key references public.employees(id) on delete cascade,  -- one running timer per person
  task_id uuid not null references public.tasks(id) on delete cascade,
  started_at timestamptz not null default now()
);
alter table public.task_timers enable row level security;

-- ---------------------------------------------------------------- client review rounds
create table if not exists public.deliverable_client_reviews (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  draft_id uuid references public.task_drafts(id) on delete set null,
  round_no integer not null check (round_no > 0),
  link text check (link is null or (link ~* '^https?://' and length(link) <= 2000)),
  message text check (message is null or length(message) <= 2000),
  sent_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','changes_requested','withdrawn')),
  client_comment text check (client_comment is null or length(client_comment) <= 2000),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  forwarded_by uuid references public.profiles(id) on delete set null,
  forwarded_at timestamptz,
  forward_note text check (forward_note is null or length(forward_note) <= 2000),
  unique (deliverable_id, round_no)
);
create unique index if not exists deliverable_client_reviews_one_pending on public.deliverable_client_reviews(deliverable_id) where status = 'pending';
create index if not exists deliverable_client_reviews_task_idx on public.deliverable_client_reviews(task_id) where task_id is not null;
alter table public.deliverable_client_reviews enable row level security;

-- ---------------------------------------------------------------- helpers
create or replace function private.today_ist()
returns date language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- Walk a deliverable to "Awaiting Client Review" through the allowed transitions.
create or replace function private.deliverable_to_client_review(p_deliverable_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text; v_guard int := 0;
begin
  perform set_config('sigma.change_reason', p_reason, true);
  loop
    select status into v_status from public.deliverables where id = p_deliverable_id;
    exit when v_status = 'Awaiting Client Review' or v_guard > 4;
    v_guard := v_guard + 1;
    update public.deliverables set status = case v_status
        when 'Draft' then 'Pending'
        when 'Pending' then 'In Progress'
        when 'Awaiting Client Dependency' then 'In Progress'
        when 'In Progress' then 'Under Internal Review'
        when 'Completed' then 'Revision In Progress'
        when 'Ready for Download' then 'Revision In Progress'
        else 'Awaiting Client Review' end,
      client_action = case when v_status in ('Under Internal Review','Revision In Progress','Modification Requested')
                           then 'Review the latest version' else client_action end
    where id = p_deliverable_id;
  end loop;
  perform private.require(v_status = 'Awaiting Client Review' or
    (select status from public.deliverables where id = p_deliverable_id) = 'Awaiting Client Review',
    'This deliverable can’t be sent for client review from its current status');
end $$;

-- ---------------------------------------------------------------- task transitions with drafts (links only)
create or replace function public.task_transition(p_task_id uuid, p_to text, p_note text default null, p_link text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks;
  v_emp uuid := private.current_employee_id();
  v_assignee boolean;
  v_reviewer boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_link text := nullif(btrim(coalesce(p_link, '')), '');
  v_blockers text;
  v_draft int;
begin
  select * into t from public.tasks where id = p_task_id and archived_at is null for update;
  perform private.require(found, 'Task not found');
  v_assignee := v_emp is not null and t.assigned_to = v_emp;
  v_reviewer := private.task_is_reviewer(t);
  perform private.require(v_assignee or v_reviewer, 'Not allowed');
  perform private.require(p_to in ('accepted','in_progress','blocked','awaiting_review','revision_required','completed','cancelled'), 'Unknown status');
  perform private.require(p_to <> t.status, 'The task is already in that state');
  perform private.require(v_note is null or length(v_note) <= 2000, 'Note is too long');

  if p_to = 'accepted' then
    perform private.require(v_assignee and t.status = 'assigned', 'Only the assignee can accept a new task');
  elsif p_to = 'in_progress' then
    perform private.require(v_assignee and t.status in ('assigned','accepted','blocked','revision_required'), 'This task can’t be started now');
    v_blockers := private.task_open_blockers(t.id);
    perform private.require(v_blockers is null, 'Waiting on: ' || coalesce(v_blockers, ''));
  elsif p_to = 'blocked' then
    perform private.require(v_assignee and t.status in ('accepted','in_progress','revision_required'), 'Only work in progress can be marked blocked');
    perform private.require(v_note is not null, 'Say what is blocking the task');
  elsif p_to = 'awaiting_review' then
    perform private.require(v_assignee and t.status in ('accepted','in_progress','revision_required'), 'This task can’t be handed in now');
    v_link := coalesce(v_link, nullif(btrim(coalesce(t.submitted_link, '')), ''));  -- same link, updated file
    perform private.require(v_link is not null, 'Add the link to this draft');
    perform private.require(v_link ~* '^https?://', 'The link must start with http:// or https://');
    perform private.require(private.task_open_subtasks(t.id) = 0, 'Finish or cancel the subtasks first');
    v_blockers := private.task_open_blockers(t.id);
    perform private.require(v_blockers is null, 'Waiting on: ' || coalesce(v_blockers, ''));
  elsif p_to = 'completed' then
    perform private.require(v_reviewer, 'Only the reviewer can approve this task');
    perform private.require(t.status = 'awaiting_review' or (v_assignee and t.status in ('accepted','in_progress')),
      'Only handed-in work can be approved');
    perform private.require(private.task_open_subtasks(t.id) = 0, 'Finish or cancel the subtasks first');
  elsif p_to = 'revision_required' then
    perform private.require(v_reviewer and t.status in ('awaiting_review','completed'), 'Only handed-in or completed work can be sent back');
    perform private.require(v_note is not null, 'Say what needs to change');
  elsif p_to = 'cancelled' then
    perform private.require(v_reviewer and t.status not in ('completed','cancelled'), 'Only the reviewer can cancel an open task');
    perform private.require(v_note is not null, 'Give a reason for cancelling');
  end if;

  perform set_config('sigma.task_rpc', 'on', true);

  -- Draft history
  if p_to = 'awaiting_review' then
    select coalesce(max(draft_no), 0) + 1 into v_draft from public.task_drafts where task_id = t.id;
    insert into public.task_drafts(task_id, draft_no, link, note, submitted_by, on_time)
    values (t.id, v_draft, v_link, v_note, v_emp, private.today_ist() <= t.due_date);
  elsif p_to in ('completed','revision_required') and t.status = 'awaiting_review' then
    update public.task_drafts set decision = case when p_to = 'completed' then 'approved' else 'changes_requested' end,
      decided_by = auth.uid(), decided_at = now(), feedback = v_note
    where id = (select id from public.task_drafts where task_id = t.id and decision = 'pending' order by draft_no desc limit 1);
  end if;

  -- Stop a running timer when work leaves the assignee's hands.
  if p_to in ('awaiting_review','completed','cancelled','blocked') then
    perform private.task_timer_close(t.id);
  end if;

  update public.tasks set
    status = p_to,
    status_note = case when p_to in ('blocked','revision_required','cancelled','awaiting_review') then v_note else null end,
    accepted_at = case when p_to in ('accepted','in_progress') then coalesce(accepted_at, now()) else accepted_at end,
    started_at = case when p_to = 'in_progress' then coalesce(started_at, now()) else started_at end,
    submitted_link = case when p_to = 'awaiting_review' then v_link else submitted_link end,
    submitted_at = case when p_to = 'awaiting_review' then now() else submitted_at end,
    progress_pct = case when p_to in ('awaiting_review','completed') then 100
                        when p_to = 'revision_required' then least(progress_pct, 90) else progress_pct end,
    completed_at = case when p_to = 'completed' then now() when p_to = 'revision_required' then null else completed_at end,
    cancelled_at = case when p_to = 'cancelled' then now() else cancelled_at end,
    reviewed_by = case when p_to in ('completed','revision_required') then auth.uid() else reviewed_by end,
    reviewed_at = case when p_to in ('completed','revision_required') then now() else reviewed_at end
  where id = t.id;
  perform set_config('sigma.task_rpc', '', true);
  return p_to;
end $$;

-- Older app versions complete a task directly with a link: keep a draft record for history.
create or replace function private.record_task_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.current_employee_id(); v_draft int;
begin
  if TG_OP = 'INSERT' then
    insert into public.task_events(task_id, event_type, actor_employee_id, metadata)
    values (NEW.id, 'assigned', coalesce(actor, NEW.assigned_by), jsonb_build_object('parent_task_id', NEW.parent_task_id));
  elsif NEW.archived_at is distinct from OLD.archived_at and NEW.archived_at is not null then
    insert into public.task_events(task_id, event_type, actor_employee_id, metadata)
    values (NEW.id, 'removed', actor, jsonb_build_object('archived_at', NEW.archived_at, 'actor_user_id', auth.uid()));
  elsif NEW.status <> OLD.status then
    insert into public.task_events(task_id, event_type, actor_employee_id, metadata)
    values (NEW.id, NEW.status, actor, jsonb_build_object('from', OLD.status, 'note', NEW.status_note, 'submitted_at', NEW.submitted_at, 'actor_user_id', auth.uid()));
    if NEW.status = 'completed' and OLD.status in ('assigned','accepted','in_progress','revision_required')
       and NEW.submitted_link is not null and NEW.submitted_link ~* '^https?://' then
      select coalesce(max(draft_no), 0) + 1 into v_draft from public.task_drafts where task_id = NEW.id;
      insert into public.task_drafts(task_id, draft_no, link, submitted_by, on_time, decision, decided_at, feedback)
      values (NEW.id, v_draft, NEW.submitted_link, NEW.assigned_to, private.today_ist() <= NEW.due_date, 'auto_approved', now(), 'Completed without a review step');
    end if;
  end if;
  return NEW;
end $$;

-- ---------------------------------------------------------------- timer
create or replace function private.task_timer_close(p_task_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare tm public.task_timers; v_min int; v_prev text := coalesce(current_setting('sigma.task_rpc', true), '');
begin
  select * into tm from public.task_timers where task_id = p_task_id for update;
  if not found then return 0; end if;
  v_min := greatest(1, least(960, ceil(extract(epoch from (now() - tm.started_at)) / 60.0)::int));
  delete from public.task_timers where employee_id = tm.employee_id;
  insert into public.task_time_logs(task_id, employee_id, work_date, minutes, note)
  values (tm.task_id, tm.employee_id, (tm.started_at at time zone 'Asia/Kolkata')::date, v_min, 'Timer');
  perform set_config('sigma.task_rpc', 'on', true);
  update public.tasks set time_spent_minutes = (select coalesce(sum(minutes), 0) from public.task_time_logs where task_id = tm.task_id) where id = tm.task_id;
  perform set_config('sigma.task_rpc', v_prev, true);  -- callers may already have the flag on
  return v_min;
end $$;

create or replace function public.task_timer_start(p_task_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare t public.tasks; v_emp uuid := private.current_employee_id(); v_other uuid; v_at timestamptz;
begin
  select * into t from public.tasks where id = p_task_id and archived_at is null;
  perform private.require(found and v_emp is not null and t.assigned_to = v_emp, 'Only the assignee can track time on this task');
  perform private.require(t.status not in ('completed','cancelled','awaiting_review'), 'This task isn’t open for work');
  if t.status in ('assigned','accepted','blocked','revision_required') then
    perform public.task_transition(t.id, 'in_progress');
  end if;
  select task_id into v_other from public.task_timers where employee_id = v_emp;
  if v_other = t.id then
    select started_at into v_at from public.task_timers where employee_id = v_emp;
    return v_at;
  elsif v_other is not null then
    perform private.task_timer_close(v_other);
  end if;
  insert into public.task_timers(employee_id, task_id) values (v_emp, t.id) returning started_at into v_at;
  return v_at;
end $$;

create or replace function public.task_timer_stop()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_task uuid;
begin
  select task_id into v_task from public.task_timers where employee_id = private.current_employee_id();
  if v_task is null then return 0; end if;
  return private.task_timer_close(v_task);
end $$;

create or replace function public.task_set_estimate(p_task_id uuid, p_minutes integer)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and archived_at is null for update;
  perform private.require(found and private.task_is_reviewer(t), 'Only the person who assigned the task can set its estimate');
  perform private.require(p_minutes is null or p_minutes between 1 and 100000, 'Estimate must be between 1 minute and 1,666 hours');
  perform set_config('sigma.task_rpc', 'on', true);
  update public.tasks set estimate_minutes = p_minutes where id = t.id;
  perform set_config('sigma.task_rpc', '', true);
end $$;

-- ---------------------------------------------------------------- send to client / client decision / forward
create or replace function public.staff_send_to_client(p_deliverable_id uuid, p_link text, p_message text default null, p_task_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.deliverables; t public.tasks; v_link text := nullif(btrim(coalesce(p_link, '')), ''); v_round int; v_id uuid; v_draft uuid;
begin
  select * into d from public.deliverables where id = p_deliverable_id and deleted_at is null for update;
  perform private.require(found, 'Deliverable not found');
  perform private.require(private.current_client_id() is null and private.can_manage_project(d.project_id), 'Only a manager or admin can send work to the client');
  perform private.require(d.status not in ('Draft','Cancelled'), 'This deliverable isn’t active');
  perform private.require(not exists (select 1 from public.deliverable_client_reviews where deliverable_id = d.id and status = 'pending'),
    'The client is still reviewing the last version');
  if p_task_id is not null then
    select * into t from public.tasks where id = p_task_id and archived_at is null;
    perform private.require(found and t.deliverable_id = d.id, 'That task isn’t linked to this deliverable');
    perform private.require(t.status = 'completed', 'Approve the work internally before sending it to the client');
    select id, coalesce(v_link, link) into v_draft, v_link from public.task_drafts
      where task_id = t.id and decision in ('approved','auto_approved') order by draft_no desc limit 1;
    v_link := coalesce(v_link, t.submitted_link);
  end if;
  perform private.require(v_link is not null and v_link ~* '^https?://', 'Add the link the client should review');
  select coalesce(max(round_no), 0) + 1 into v_round from public.deliverable_client_reviews where deliverable_id = d.id;
  perform private.deliverable_to_client_review(d.id, 'Version ' || v_round || ' sent to client');
  insert into public.deliverable_client_reviews(deliverable_id, project_id, client_id, task_id, draft_id, round_no, link, message, sent_by)
  values (d.id, d.project_id, d.client_id, p_task_id, v_draft, v_round, v_link, nullif(btrim(coalesce(p_message, '')), ''), auth.uid())
  returning id into v_id;
  if d.client_id is not null then
    perform private.notify_client(d.client_id, 'deliverable', 'New version to review',
      d.name || ' · version ' || v_round || ' is ready for your review.', '/client/deliverables', 'client_review_' || v_id);
  end if;
  return v_id;
end $$;

create or replace function public.client_decide_review(p_review_id uuid, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.deliverable_client_reviews; d public.deliverables; v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into r from public.deliverable_client_reviews where id = p_review_id for update;
  perform private.require(found and r.status = 'pending', 'This version is no longer waiting for your review');
  select * into d from public.deliverables where id = r.deliverable_id for update;
  perform private.require(d.client_id = private.current_client_id() and private.is_client_of_project(d.project_id), 'Deliverable not found');
  perform private.require(private.has_permission('client.deliverable.review'), 'Your account is not permitted to review deliverables');
  perform private.require(p_approve or length(coalesce(v_comment, '')) >= 5, 'Describe the changes you need');
  update public.deliverable_client_reviews set status = case when p_approve then 'approved' else 'changes_requested' end,
    client_comment = v_comment, decided_by = auth.uid(), decided_at = now() where id = r.id;
  if d.status = 'Awaiting Client Review' then
    perform set_config('sigma.change_reason', case when p_approve then 'Approved by client' else 'Client requested changes' end, true);
    update public.deliverables set status = case when p_approve then 'Completed' else 'Revision In Progress' end, client_action = null where id = d.id;
  end if;
  perform private.notify_project_staff(d.project_id, 'deliverable',
    case when p_approve then 'Client approved ' || d.name else 'Client requested changes on ' || d.name end,
    'Version ' || r.round_no || coalesce(': “' || left(v_comment, 160) || '”', ''),
    '/admin-clients?project=' || d.project_id || '&view=deliverables', 'client_decision_' || r.id);
end $$;

-- Pass the client's feedback to the employee as a new internal round (reopens the task).
create or replace function public.staff_forward_client_feedback(p_review_id uuid, p_note text default null, p_task_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.deliverable_client_reviews; t public.tasks; v_task uuid; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_msg text;
begin
  select * into r from public.deliverable_client_reviews where id = p_review_id for update;
  perform private.require(found and r.status = 'changes_requested', 'Only client change requests can be forwarded');
  perform private.require(private.current_client_id() is null and private.can_manage_project(r.project_id), 'Only a manager or admin can forward client feedback');
  v_task := coalesce(p_task_id, r.task_id);
  perform private.require(v_task is not null, 'Choose the task to send this feedback to');
  select * into t from public.tasks where id = v_task and archived_at is null for update;
  perform private.require(found and t.deliverable_id = r.deliverable_id, 'That task isn’t linked to this deliverable');
  v_msg := 'Client feedback on version ' || r.round_no || ': “' || coalesce(r.client_comment, '') || '”' || coalesce(E'\n\n' || v_note, '');
  update public.deliverable_client_reviews set forwarded_by = auth.uid(), forwarded_at = now(), forward_note = v_note,
    task_id = coalesce(task_id, v_task) where id = r.id;
  insert into public.task_comments(task_id, author_id, body) values (t.id, auth.uid(), left(v_msg, 4000));
  perform set_config('sigma.task_rpc', 'on', true);
  update public.tasks set status = 'revision_required', status_note = left(v_msg, 2000), completed_at = null,
    progress_pct = least(progress_pct, 90), reviewed_by = auth.uid(), reviewed_at = now()
  where id = t.id and status <> 'revision_required';
  perform set_config('sigma.task_rpc', '', true);
end $$;

-- What the client sees: their versions, signed by IRA, links hidden on approved versions while payment-locked.
create or replace function public.client_deliverable_reviews(p_deliverable_id uuid)
returns table (id uuid, round_no integer, link text, message text, sent_at timestamptz, status text, client_comment text, decided_at timestamptz, link_locked boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.round_no,
         case when r.status = 'approved' and d.lock_state in ('locked_payment','locked_manual') then null else r.link end,
         r.message, r.sent_at, r.status, r.client_comment, r.decided_at,
         (r.status = 'approved' and d.lock_state in ('locked_payment','locked_manual'))
  from public.deliverable_client_reviews r join public.deliverables d on d.id = r.deliverable_id
  where r.deliverable_id = p_deliverable_id and r.status <> 'withdrawn' and private.is_deliverable_client(p_deliverable_id)
  order by r.round_no desc
$$;

-- Legacy client review (no version sent through the new flow): approve completes; changes are recorded as a round.
create or replace function public.client_review_deliverable(p_deliverable_id uuid, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.deliverables; v_pending uuid; v_round int; v_id uuid;
begin
  select id into v_pending from public.deliverable_client_reviews where deliverable_id = p_deliverable_id and status = 'pending';
  if v_pending is not null then
    perform public.client_decide_review(v_pending, p_approve, p_comment);
    return;
  end if;
  select * into d from public.deliverables where id = p_deliverable_id and deleted_at is null for update;
  perform private.require(found and d.client_id = private.current_client_id() and private.is_client_of_project(d.project_id), 'Deliverable not found');
  perform private.require(d.status = 'Awaiting Client Review', 'This deliverable is not awaiting your review');
  select coalesce(max(round_no), 0) + 1 into v_round from public.deliverable_client_reviews where deliverable_id = d.id;
  insert into public.deliverable_client_reviews(deliverable_id, project_id, client_id, round_no, status)
  values (d.id, d.project_id, d.client_id, v_round, 'pending') returning id into v_id;
  perform public.client_decide_review(v_id, p_approve, p_comment);
end $$;


-- ---------------------------------------------------------------- productivity metrics
-- Per-employee review metrics for a period (by task assignment date). Self, reporting manager, or admin / kra.manage.
create or replace function public.employee_review_metrics(p_employee_id uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := coalesce(p_employee_id, private.current_employee_id()); v jsonb;
  v_from date := coalesce(p_from, private.today_ist() - 89); v_to date := coalesce(p_to, private.today_ist());
begin
  perform private.require(v_emp is not null, 'Employee not found');
  perform private.require(v_emp = private.current_employee_id() or private.is_manager_of(v_emp) or private.can_manage_performance(), 'Not allowed');
  with t as (
    select * from public.tasks where assigned_to = v_emp and archived_at is null and status <> 'cancelled'
      and (created_at at time zone 'Asia/Kolkata')::date between v_from and v_to
  ), d as (
    select dr.* from public.task_drafts dr join t on t.id = dr.task_id
  ), first as (
    select distinct on (task_id) task_id, decision, submitted_at from d order by task_id, draft_no
  ), cr as (
    select r.* from public.deliverable_client_reviews r join t on t.id = r.task_id where r.status in ('approved','changes_requested')
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'tasks', (select count(*) from t),
    'completed', (select count(*) from t where status = 'completed'),
    'open', (select count(*) from t where status not in ('completed')),
    'overdue', (select count(*) from t where status not in ('completed','awaiting_review') and due_date < private.today_ist()),
    'drafts', (select count(*) from d),
    'drafts_per_task', (select round(avg(n), 2) from (select count(*) n from d group by task_id) x),
    'approved_drafts', (select count(*) from d where decision in ('approved','auto_approved')),
    'changes_drafts', (select count(*) from d where decision = 'changes_requested'),
    'pending_drafts', (select count(*) from d where decision = 'pending'),
    'approval_rate', (select round(100.0 * count(*) filter (where decision in ('approved','auto_approved')) / nullif(count(*) filter (where decision <> 'pending'), 0), 1) from d),
    'first_draft_approval_rate', (select round(100.0 * count(*) filter (where decision in ('approved','auto_approved')) / nullif(count(*) filter (where decision <> 'pending'), 0), 1) from first),
    'on_time_rate', (select round(100.0 * count(*) filter (where (completed_at at time zone 'Asia/Kolkata')::date <= due_date) / nullif(count(*), 0), 1) from t where status = 'completed'),
    'avg_cycle_hours', (select round(avg(extract(epoch from (completed_at - created_at)) / 3600)::numeric, 1) from t where status = 'completed' and completed_at is not null),
    'avg_first_draft_hours', (select round(avg(extract(epoch from (f.submitted_at - t.created_at)) / 3600)::numeric, 1) from first f join t on t.id = f.task_id),
    'avg_review_hours', (select round(avg(extract(epoch from (decided_at - submitted_at)) / 3600)::numeric, 1) from d where decided_at is not null and decision <> 'auto_approved'),
    'logged_minutes', (select coalesce(sum(l.minutes), 0) from public.task_time_logs l join t on t.id = l.task_id),
    'estimate_minutes', (select coalesce(sum(estimate_minutes), 0) from t where status = 'completed' and estimate_minutes is not null),
    'estimate_actual_minutes', (select coalesce(sum(time_spent_minutes), 0) from t where status = 'completed' and estimate_minutes is not null),
    'client_rounds', (select count(*) from cr),
    'client_approved', (select count(*) from cr where status = 'approved'),
    'client_changes', (select count(*) from cr where status = 'changes_requested'),
    'client_first_time_rate', (select round(100.0 * count(*) filter (where status = 'approved') / nullif(count(*), 0), 1)
                               from (select distinct on (task_id) task_id, status from cr order by task_id, round_no) x)
  ) into v;
  return v;
end $$;

-- Team summary for managers (their reports) and admins (everyone active).
create or replace function public.team_review_metrics(p_from date default null, p_to date default null)
returns table (employee_id uuid, name text, metrics jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  select e.id, e.name, public.employee_review_metrics(e.id, p_from, p_to)
  from public.employees e
  where e.status = 'active' and (private.can_manage_performance() or e.manager_id = private.current_employee_id())
  order by e.name;
end $$;

-- ---------------------------------------------------------------- RLS & grants
drop policy if exists task_drafts_select on public.task_drafts;
create policy task_drafts_select on public.task_drafts for select to authenticated using (private.can_view_task(task_id));
drop policy if exists task_timers_select on public.task_timers;
create policy task_timers_select on public.task_timers for select to authenticated
  using (employee_id = private.current_employee_id() or private.can_view_task(task_id));
drop policy if exists deliverable_client_reviews_staff_select on public.deliverable_client_reviews;
create policy deliverable_client_reviews_staff_select on public.deliverable_client_reviews for select to authenticated
  using (private.current_client_id() is null and private.can_manage_project(project_id));

revoke all on public.task_drafts, public.task_timers, public.deliverable_client_reviews from anon;
revoke insert, update, delete, truncate, trigger, references on public.task_drafts, public.task_timers, public.deliverable_client_reviews from authenticated;
grant select on public.task_drafts, public.task_timers, public.deliverable_client_reviews to authenticated;

revoke execute on function private.deliverable_to_client_review(uuid, text), private.task_timer_close(uuid) from public, anon, authenticated;
revoke execute on function public.task_set_estimate(uuid, integer) from public, anon;
grant execute on function public.task_set_estimate(uuid, integer) to authenticated;
revoke execute on function public.task_timer_start(uuid), public.task_timer_stop(), public.staff_send_to_client(uuid, text, text, uuid),
  public.client_decide_review(uuid, boolean, text), public.staff_forward_client_feedback(uuid, text, uuid),
  public.client_deliverable_reviews(uuid) from public, anon;
grant execute on function public.task_timer_start(uuid), public.task_timer_stop(), public.staff_send_to_client(uuid, text, text, uuid),
  public.client_decide_review(uuid, boolean, text), public.staff_forward_client_feedback(uuid, text, uuid),
  public.client_deliverable_reviews(uuid), public.client_review_deliverable(uuid, boolean, text) to authenticated;
grant execute on function private.today_ist() to authenticated;
revoke execute on function public.employee_review_metrics(uuid, date, date), public.team_review_metrics(date, date) from public, anon;
grant execute on function public.employee_review_metrics(uuid, date, date), public.team_review_metrics(date, date) to authenticated;
