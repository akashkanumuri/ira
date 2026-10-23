-- SIGMA 1 — Task workflow (spec 27–28, 35–36)
--
-- Additive: new statuses, progress, time logs, comments, subtasks,
-- dependencies and due-date reminders. Existing rows keep their status
-- ('assigned' / 'completed'); only the new columns are backfilled.
--
-- Status flow
--   assigned → accepted → in_progress ⇄ blocked
--   accepted / in_progress / revision_required → awaiting_review   (assignee hands in)
--   awaiting_review → completed | revision_required                (reviewer)
--   completed → revision_required                                  (reviewer reopens)
--   any open status → cancelled                                    (reviewer)
-- Reviewer = admin, the employee who assigned the task, or a manager of the linked project.

-- ---------------------------------------------------------------- columns
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (status in
  ('assigned','accepted','in_progress','blocked','awaiting_review','revision_required','completed','cancelled'));

alter table public.tasks
  add column if not exists progress_pct smallint not null default 0,
  add column if not exists time_spent_minutes integer not null default 0,
  add column if not exists parent_task_id uuid references public.tasks(id) on delete restrict,
  add column if not exists accepted_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists status_note text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

do $$ begin
  alter table public.tasks add constraint tasks_progress_pct_check check (progress_pct between 0 and 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_time_spent_check check (time_spent_minutes >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_parent_not_self check (parent_task_id is null or parent_task_id <> id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_status_note_len check (status_note is null or length(status_note) <= 2000);
exception when duplicate_object then null; end $$;

create index if not exists tasks_parent_idx on public.tasks(parent_task_id) where parent_task_id is not null;
create index if not exists tasks_open_due_idx on public.tasks(due_date)
  where archived_at is null and status not in ('completed','cancelled');

-- ---------------------------------------------------------------- new tables
create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments(task_id, created_at);

create table if not exists public.task_dependencies (
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_id uuid not null references public.tasks(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);
create index if not exists task_dependencies_on_idx on public.task_dependencies(depends_on_id);

create table if not exists public.task_time_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  work_date date not null,
  minutes integer not null check (minutes between 1 and 960),
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists task_time_logs_task_idx on public.task_time_logs(task_id, work_date);

alter table public.task_comments enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_time_logs enable row level security;

-- ---------------------------------------------------------------- helpers
create or replace function private.task_is_reviewer(t public.tasks)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (t.assigned_by is not null and t.assigned_by = private.current_employee_id())
      or (t.project_id is not null and private.can_manage_project(t.project_id))
$$;

create or replace function private.can_view_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and (private.is_admin()
        or (t.archived_at is null and (
              t.assigned_to = private.current_employee_id()
           or t.assigned_by = private.current_employee_id()
           or (t.project_id is not null and private.can_manage_project(t.project_id))
           or exists (select 1 from public.tasks p where p.id = t.parent_task_id
                      and (p.assigned_to = private.current_employee_id() or p.assigned_by = private.current_employee_id())))))
  )
$$;

-- Who hears about the assignee's progress: the assigner, or every admin when an admin assigned it.
create or replace function private.notify_task_reviewers(t public.tasks, p_title text, p_message text, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if t.assigned_by is not null then
    perform private.notify_employee(t.assigned_by, 'task', p_title, p_message, '/emp-tasks', p_key);
  else
    for r in select id from public.profiles where role = 'admin' and id is distinct from auth.uid() loop
      perform private.notify(r.id, 'task', p_title, p_message, '/admin-tasks', p_key, jsonb_build_object('task_id', t.id));
    end loop;
  end if;
end $$;

create or replace function private.task_open_blockers(p_task_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select string_agg(b.title, ', ' order by b.due_date)
  from public.task_dependencies d join public.tasks b on b.id = d.depends_on_id
  where d.task_id = p_task_id and b.archived_at is null and b.status not in ('completed','cancelled')
$$;

create or replace function private.task_open_subtasks(p_task_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.tasks s
  where s.parent_task_id = p_task_id and s.archived_at is null and s.status not in ('completed','cancelled')
$$;

-- ---------------------------------------------------------------- triggers
create or replace function private.validate_task_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare eid uuid := private.current_employee_id();
begin
  NEW.created_at := coalesce(NEW.created_at, now()); NEW.updated_at := now();
  if private.is_admin() or coalesce(current_setting('sigma.task_rpc', true), '') = 'on' then
    return NEW;
  end if;
  if eid is null or NEW.assigned_by <> eid then raise exception 'Invalid task assigner'; end if;
  if not private.can_assign_task(NEW.assigned_to) then raise exception 'You are not allowed to assign this employee'; end if;
  NEW.status := 'assigned';
  NEW.submitted_link := null; NEW.submitted_at := null;
  NEW.progress_pct := 0; NEW.time_spent_minutes := 0;
  NEW.accepted_at := null; NEW.started_at := null; NEW.completed_at := null; NEW.cancelled_at := null;
  NEW.reviewed_by := null; NEW.reviewed_at := null; NEW.status_note := null;
  NEW.parent_task_id := null; -- subtasks go through task_create_subtask()
  return NEW;
end $$;

create or replace function private.validate_task_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  eid uuid := private.current_employee_id();
  is_assignee boolean := (OLD.assigned_to = eid) and (NEW.assigned_to = OLD.assigned_to);
  is_assigner boolean := (OLD.assigned_by is not null) and (OLD.assigned_by = eid);
begin
  NEW.updated_at := now();
  if private.is_admin() or coalesce(current_setting('sigma.task_rpc', true), '') = 'on' then
    return NEW;
  end if;

  -- Workflow columns only change through the task_* functions.
  NEW.time_spent_minutes := OLD.time_spent_minutes;
  NEW.parent_task_id := OLD.parent_task_id;
  NEW.accepted_at := OLD.accepted_at; NEW.started_at := OLD.started_at;
  NEW.completed_at := OLD.completed_at; NEW.cancelled_at := OLD.cancelled_at;
  NEW.reviewed_by := OLD.reviewed_by; NEW.reviewed_at := OLD.reviewed_at;
  NEW.status_note := OLD.status_note;
  NEW.created_at := OLD.created_at;

  if is_assignee and not is_assigner then
    NEW.title := OLD.title; NEW.description := OLD.description;
    NEW.assigned_to := OLD.assigned_to; NEW.assigned_by := OLD.assigned_by;
    NEW.start_date := OLD.start_date; NEW.due_date := OLD.due_date; NEW.priority := OLD.priority;
    NEW.project_id := OLD.project_id; NEW.deliverable_id := OLD.deliverable_id;
    NEW.archived_at := OLD.archived_at;

    -- Older app versions (still live until this release ships) hand work in by
    -- setting status 'completed' directly. Keep that working unchanged; the new
    -- app goes through task_transition() and its review step instead.
    if NEW.status is distinct from OLD.status and NEW.status = 'completed'
       and OLD.status in ('assigned','accepted','in_progress','revision_required') then
      if NEW.submitted_link is null or btrim(NEW.submitted_link) !~* '^https?://' then
        raise exception 'A valid completed work link is required';
      end if;
      if private.task_open_subtasks(OLD.id) > 0 then raise exception 'Finish or cancel the subtasks first'; end if;
      NEW.submitted_link := btrim(NEW.submitted_link);
      NEW.submitted_at := now();
      NEW.completed_at := now();
      NEW.progress_pct := 100;
    else
      NEW.status := OLD.status;
      NEW.submitted_link := OLD.submitted_link;
      NEW.submitted_at := OLD.submitted_at;
      NEW.progress_pct := OLD.progress_pct;
    end if;
    return NEW;
  end if;

  if is_assigner then
    if NEW.assigned_to <> OLD.assigned_to and not private.can_assign_task(NEW.assigned_to) then
      raise exception 'You are not allowed to assign this employee';
    end if;
    NEW.assigned_by := OLD.assigned_by;
    NEW.status := OLD.status;
    NEW.submitted_link := OLD.submitted_link; NEW.submitted_at := OLD.submitted_at;
    NEW.progress_pct := OLD.progress_pct;
    return NEW;
  end if;

  raise exception 'Unauthorized task update';
end $$;

create or replace function private.record_task_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.current_employee_id();
begin
  if TG_OP = 'INSERT' then
    insert into public.task_events(task_id, event_type, actor_employee_id, metadata)
    values (NEW.id, 'assigned', coalesce(actor, NEW.assigned_by),
            jsonb_build_object('parent_task_id', NEW.parent_task_id));
  elsif NEW.archived_at is distinct from OLD.archived_at and NEW.archived_at is not null then
    insert into public.task_events(task_id, event_type, actor_employee_id, metadata)
    values (NEW.id, 'removed', actor, jsonb_build_object('archived_at', NEW.archived_at, 'actor_user_id', auth.uid()));
  elsif NEW.status <> OLD.status then
    insert into public.task_events(task_id, event_type, actor_employee_id, metadata)
    values (NEW.id, NEW.status, actor,
            jsonb_build_object('from', OLD.status, 'note', NEW.status_note, 'submitted_at', NEW.submitted_at,
                               'actor_user_id', auth.uid()));
  end if;
  return NEW;
end $$;

create or replace function public.trg_notify_task()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_title text := NEW.title;
begin
  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and OLD.assigned_to is distinct from NEW.assigned_to) then
    perform private.notify_employee(NEW.assigned_to, 'task',
      case when NEW.parent_task_id is null then 'New task assigned' else 'New subtask assigned' end,
      '"' || v_title || '" · due ' || to_char(NEW.due_date, 'DD Mon'), '/emp-tasks',
      'task_assign_' || NEW.id || '_' || NEW.assigned_to);
    return NEW;
  end if;

  if TG_OP <> 'UPDATE' or NEW.status = OLD.status then return NEW; end if;

  case NEW.status
    when 'awaiting_review' then
      perform private.notify_task_reviewers(NEW, 'Task ready for review',
        '"' || v_title || '" was handed in.', 'task_review_' || NEW.id || '_' || extract(epoch from NEW.updated_at)::bigint);
    when 'blocked' then
      perform private.notify_task_reviewers(NEW, 'Task blocked',
        '"' || v_title || '": ' || coalesce(NEW.status_note, 'no reason given'), 'task_blocked_' || NEW.id || '_' || extract(epoch from NEW.updated_at)::bigint);
    when 'completed' then
      if OLD.status <> 'awaiting_review' and private.current_employee_id() = NEW.assigned_to then
        -- finished directly by the assignee (older app, or their own subtask)
        perform private.notify_task_reviewers(NEW, 'Task completed',
          '"' || v_title || '" was completed.', 'task_done_' || NEW.id || '_' || extract(epoch from NEW.updated_at)::bigint);
      else
        perform private.notify_employee(NEW.assigned_to, 'task', 'Task approved',
          '"' || v_title || '" is marked complete.', '/emp-tasks', 'task_done_' || NEW.id || '_' || extract(epoch from NEW.updated_at)::bigint);
      end if;
    when 'revision_required' then
      perform private.notify_employee(NEW.assigned_to, 'task', 'Changes requested',
        '"' || v_title || '": ' || coalesce(NEW.status_note, ''), '/emp-tasks', 'task_revise_' || NEW.id || '_' || extract(epoch from NEW.updated_at)::bigint);
    when 'cancelled' then
      perform private.notify_employee(NEW.assigned_to, 'task', 'Task cancelled',
        '"' || v_title || '": ' || coalesce(NEW.status_note, ''), '/emp-tasks', 'task_cancel_' || NEW.id);
    else null;
  end case;
  return NEW;
end $$;

-- Backfill (column-only; the flag lets the trigger accept it, and no status changes so nothing is notified).
select set_config('sigma.task_rpc', 'on', true);
update public.tasks set progress_pct = 100, completed_at = coalesce(submitted_at, updated_at)
where status = 'completed' and completed_at is null;
select set_config('sigma.task_rpc', '', true);

-- ---------------------------------------------------------------- workflow functions
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
    perform private.require(v_link is null or v_link ~* '^https?://', 'The work link must start with http:// or https://');
    perform private.require(v_link is not null or t.submitted_link is not null
      or exists (select 1 from public.files f where f.parent_type = 'task' and f.parent_id = t.id and f.deleted_at is null),
      'Add a link or attach a file before handing in');
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
  update public.tasks set
    status = p_to,
    status_note = case when p_to in ('blocked','revision_required','cancelled') then v_note
                       when p_to = 'awaiting_review' then v_note else null end,
    accepted_at = case when p_to in ('accepted','in_progress') then coalesce(accepted_at, now()) else accepted_at end,
    started_at = case when p_to = 'in_progress' then coalesce(started_at, now()) else started_at end,
    submitted_link = case when p_to = 'awaiting_review' then coalesce(v_link, submitted_link) else submitted_link end,
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

create or replace function public.task_set_progress(p_task_id uuid, p_pct integer)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and archived_at is null for update;
  perform private.require(found, 'Task not found');
  perform private.require(t.assigned_to = private.current_employee_id(), 'Only the assignee can update progress');
  perform private.require(t.status in ('accepted','in_progress','blocked','revision_required'), 'Start the task before updating progress');
  perform private.require(p_pct between 0 and 99, 'Progress must be 0–99%. Hand the task in to finish it.');
  perform set_config('sigma.task_rpc', 'on', true);
  update public.tasks set progress_pct = p_pct where id = t.id;
  perform set_config('sigma.task_rpc', '', true);
end $$;

create or replace function public.task_log_time(p_task_id uuid, p_minutes integer, p_work_date date, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.tasks; v_emp uuid := private.current_employee_id(); v_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into t from public.tasks where id = p_task_id and archived_at is null for update;
  perform private.require(found, 'Task not found');
  perform private.require(v_emp is not null and t.assigned_to = v_emp, 'Only the assignee can log time');
  perform private.require(t.status not in ('cancelled'), 'This task was cancelled');
  perform private.require(p_minutes between 1 and 960, 'Log between 1 minute and 16 hours');
  perform private.require(p_work_date is not null and p_work_date <= v_today and p_work_date >= v_today - 31, 'Pick a date within the last 31 days');
  insert into public.task_time_logs(task_id, employee_id, work_date, minutes, note)
  values (t.id, v_emp, p_work_date, p_minutes, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  perform set_config('sigma.task_rpc', 'on', true);
  update public.tasks set time_spent_minutes = (select coalesce(sum(minutes), 0) from public.task_time_logs where task_id = t.id)
  where id = t.id;
  perform set_config('sigma.task_rpc', '', true);
  return v_id;
end $$;

create or replace function public.task_add_comment(p_task_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.tasks; v_id uuid; v_body text := btrim(coalesce(p_body, ''));
  v_emp uuid := private.current_employee_id();
begin
  select * into t from public.tasks where id = p_task_id and archived_at is null;
  perform private.require(found and private.can_view_task(t.id), 'Task not found');
  perform private.require(length(v_body) between 1 and 4000, 'Write a comment (up to 4000 characters)');
  insert into public.task_comments(task_id, author_id, body) values (t.id, auth.uid(), v_body) returning id into v_id;
  if v_emp is distinct from t.assigned_to then
    perform private.notify_employee(t.assigned_to, 'task', 'New comment on a task',
      '"' || t.title || '": ' || left(v_body, 140), '/emp-tasks', 'task_comment_' || v_id);
  end if;
  if v_emp is not null and v_emp = t.assigned_to then
    perform private.notify_task_reviewers(t, 'New comment on a task', '"' || t.title || '": ' || left(v_body, 140), 'task_comment_' || v_id);
  elsif t.assigned_by is not null and t.assigned_by is distinct from v_emp then
    perform private.notify_employee(t.assigned_by, 'task', 'New comment on a task',
      '"' || t.title || '": ' || left(v_body, 140), '/emp-tasks', 'task_comment_' || v_id);
  end if;
  return v_id;
end $$;

create or replace function public.task_set_dependency(p_task_id uuid, p_depends_on_id uuid, p_add boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and archived_at is null for update;
  perform private.require(found, 'Task not found');
  perform private.require(private.task_is_reviewer(t), 'Only the person who assigned the task can change what it waits on');
  if not coalesce(p_add, true) then
    delete from public.task_dependencies where task_id = t.id and depends_on_id = p_depends_on_id;
    return;
  end if;
  perform private.require(p_depends_on_id <> t.id, 'A task can’t wait on itself');
  perform private.require(private.can_view_task(p_depends_on_id), 'Task to wait on not found');
  perform private.require(not exists (
    with recursive chain(id) as (
      select depends_on_id from public.task_dependencies where task_id = p_depends_on_id
      union
      select d.depends_on_id from public.task_dependencies d join chain c on d.task_id = c.id
    ) select 1 from chain where id = t.id), 'That would make the tasks wait on each other');
  insert into public.task_dependencies(task_id, depends_on_id, created_by)
  values (t.id, p_depends_on_id, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.task_create_subtask(p_parent_id uuid, p_title text, p_due_date date,
  p_assigned_to uuid default null, p_description text default null, p_priority text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.tasks; v_emp uuid := private.current_employee_id(); v_to uuid; v_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date; v_title text := btrim(coalesce(p_title, ''));
begin
  select * into p from public.tasks where id = p_parent_id and archived_at is null for update;
  perform private.require(found, 'Task not found');
  perform private.require(p.parent_task_id is null, 'Subtasks can’t have their own subtasks');
  perform private.require(p.status not in ('completed','cancelled','awaiting_review'), 'This task is closed or under review');
  perform private.require(length(v_title) between 2 and 200, 'Give the subtask a title');
  v_to := coalesce(p_assigned_to, p.assigned_to);
  -- The assignee may split their own work; reviewers may hand subtasks to anyone they can assign.
  perform private.require(
    (v_emp is not null and p.assigned_to = v_emp and v_to = v_emp)
    or (private.task_is_reviewer(p) and (v_to = p.assigned_to or private.can_assign_task(v_to))),
    'You can’t give this subtask to that person');
  perform private.require(p_due_date is not null and p_due_date >= least(v_today, p.start_date) and p_due_date <= p.due_date,
    'The subtask must be due on or before the main task (' || to_char(p.due_date, 'DD Mon') || ')');
  perform private.require(p_priority is null or p_priority in ('low','medium','high','urgent'), 'Invalid priority');
  perform set_config('sigma.task_rpc', 'on', true);
  insert into public.tasks(title, description, assigned_to, assigned_by, start_date, due_date, priority, status,
                           parent_task_id, project_id, deliverable_id)
  values (v_title, nullif(btrim(coalesce(p_description, '')), ''), v_to,
          case when private.is_admin() and v_emp is null then p.assigned_by else v_emp end,
          least(greatest(p.start_date, v_today), p_due_date), p_due_date, coalesce(p_priority, p.priority), 'assigned',
          p.id, p.project_id, p.deliverable_id)
  returning id into v_id;
  perform set_config('sigma.task_rpc', '', true);
  return v_id;
end $$;

-- ---------------------------------------------------------------- due-date reminders (daily, 09:00 IST)
create or replace function private.send_task_due_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare r public.tasks; n int := 0; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  for r in
    select t.* from public.tasks t
    where t.archived_at is null and t.status in ('assigned','accepted','in_progress','blocked','revision_required')
      and t.due_date between v_today - 1 and v_today + 1
  loop
    if r.due_date = v_today + 1 then
      perform private.notify_employee(r.assigned_to, 'task', 'Task due tomorrow', '"' || r.title || '" is due tomorrow.',
        '/emp-tasks', 'task_due_soon_' || r.id || '_' || r.due_date);
    elsif r.due_date = v_today then
      perform private.notify_employee(r.assigned_to, 'task', 'Task due today', '"' || r.title || '" is due today.',
        '/emp-tasks', 'task_due_today_' || r.id || '_' || r.due_date);
    else
      perform private.notify_employee(r.assigned_to, 'task', 'Task overdue', '"' || r.title || '" was due yesterday.',
        '/emp-tasks', 'task_overdue_' || r.id || '_' || r.due_date);
      perform private.notify_task_reviewers(r, 'Task overdue',
        '"' || r.title || '" was due yesterday and isn’t handed in.', 'task_overdue_rev_' || r.id || '_' || r.due_date);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sigma-task-due-reminders') then
    perform cron.unschedule('sigma-task-due-reminders');
  end if;
  perform cron.schedule('sigma-task-due-reminders', '30 3 * * *', 'select private.send_task_due_reminders();');
end $$;

-- ---------------------------------------------------------------- RLS & grants
drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select to authenticated
  using (private.can_view_task(task_id));
drop policy if exists task_dependencies_select on public.task_dependencies;
create policy task_dependencies_select on public.task_dependencies for select to authenticated
  using (private.can_view_task(task_id));
drop policy if exists task_time_logs_select on public.task_time_logs;
create policy task_time_logs_select on public.task_time_logs for select to authenticated
  using (private.can_view_task(task_id));

revoke all on public.task_comments, public.task_dependencies, public.task_time_logs from anon;
revoke insert, update, delete, truncate, trigger, references on public.task_comments, public.task_dependencies, public.task_time_logs from authenticated;
grant select on public.task_comments, public.task_dependencies, public.task_time_logs to authenticated;

revoke execute on function private.task_is_reviewer(public.tasks), private.can_view_task(uuid),
  private.notify_task_reviewers(public.tasks, text, text, text), private.task_open_blockers(uuid),
  private.task_open_subtasks(uuid), private.send_task_due_reminders() from public, anon;
grant execute on function private.task_is_reviewer(public.tasks), private.can_view_task(uuid),
  private.task_open_blockers(uuid), private.task_open_subtasks(uuid) to authenticated;

revoke execute on function public.task_transition(uuid, text, text, text), public.task_set_progress(uuid, integer),
  public.task_log_time(uuid, integer, date, text), public.task_add_comment(uuid, text),
  public.task_set_dependency(uuid, uuid, boolean), public.task_create_subtask(uuid, text, date, uuid, text, text) from public, anon;
grant execute on function public.task_transition(uuid, text, text, text), public.task_set_progress(uuid, integer),
  public.task_log_time(uuid, integer, date, text), public.task_add_comment(uuid, text),
  public.task_set_dependency(uuid, uuid, boolean), public.task_create_subtask(uuid, text, date, uuid, text, text) to authenticated;
