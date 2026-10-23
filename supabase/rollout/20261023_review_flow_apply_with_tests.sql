-- Applies 20261023100000..20261023150000 and 20261023170000 and runs all 7 test suites (each rolled back). Commits only if every suite reports failed=0.
begin;
set local statement_timeout='280s';
set local lock_timeout = '5s';
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
  NEW.parent_task_id := null;
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
select set_config('sigma.task_rpc', 'on', true);
update public.tasks set progress_pct = 100, completed_at = coalesce(submitted_at, updated_at)
where status = 'completed' and completed_at is null;
select set_config('sigma.task_rpc', '', true);
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
set local lock_timeout = '5s';
create table if not exists public.leave_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null check (length(btrim(name)) between 2 and 60),
  is_paid boolean not null default true,
  annual_limit numeric(5,1) check (annual_limit is null or annual_limit > 0),
  max_consecutive_days numeric(5,1) check (max_consecutive_days is null or max_consecutive_days > 0),
  document_required_after_days numeric(5,1) check (document_required_after_days is null or document_required_after_days >= 0),
  min_notice_days integer not null default 0 check (min_notice_days between 0 and 90),
  allow_half_day boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.leave_types(code, name, is_paid, sort_order) values
  ('casual', 'Casual', true, 1), ('sick', 'Sick', true, 2), ('earned', 'Earned', true, 3), ('unpaid', 'Unpaid', false, 4)
on conflict (code) do nothing;
insert into public.leave_types(code, name, is_paid, sort_order)
select distinct lower(lr.leave_type), initcap(lr.leave_type), lower(lr.leave_type) <> 'unpaid', 50
from public.leave_requests lr
where lower(lr.leave_type) ~ '^[a-z][a-z0-9_]{1,30}$'
on conflict (code) do nothing;
create table if not exists public.approval_settings (
  id boolean primary key default true check (id),
  leave_chain text not null default 'admin' check (leave_chain in ('admin','manager_then_admin','manager')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.approval_settings(id) values (true) on conflict (id) do nothing;
alter table public.leave_types enable row level security;
alter table public.approval_settings enable row level security;
alter table public.leave_requests
  add column if not exists manager_id uuid references public.employees(id) on delete set null,
  add column if not exists manager_status text,
  add column if not exists manager_note text,
  add column if not exists manager_reviewed_at timestamptz,
  add column if not exists cancelled_at timestamptz;
do $$ begin
  alter table public.leave_requests add constraint leave_requests_manager_status_check
    check (manager_status is null or manager_status in ('pending','approved','rejected','skipped'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.leave_requests add constraint leave_requests_manager_note_len check (manager_note is null or length(manager_note) <= 1000);
exception when duplicate_object then null; end $$;
alter table public.leave_requests drop constraint if exists leave_requests_status_check;
alter table public.leave_requests add constraint leave_requests_status_check check (status in ('pending','approved','rejected','cancelled'));
create index if not exists leave_requests_manager_idx on public.leave_requests(manager_id, status) where manager_id is not null;
create or replace function private.leave_has_document(p_leave_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.files f where f.parent_type = 'leave' and f.parent_id = p_leave_id and f.deleted_at is null)
$$;
create or replace function private.leave_check_document(r public.leave_requests)
returns void language plpgsql stable security definer set search_path = '' as $$
declare t public.leave_types;
begin
  select * into t from public.leave_types where code = lower(r.leave_type);
  if found and t.document_required_after_days is not null and r.days > t.document_required_after_days
     and not private.leave_has_document(r.id) then
    raise exception '% leave longer than % day(s) needs a supporting document before it can be approved',
      t.name, t.document_required_after_days using errcode = 'P0001';
  end if;
end $$;
create or replace function private.validate_leave_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  eid uuid := private.current_employee_id();
  calculated numeric;
  t public.leave_types;
  used numeric;
  v_chain text;
  v_mgr uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.leave_type := lower(btrim(new.leave_type));
  if private.is_admin() then
    if new.manager_status is null then new.manager_status := 'skipped'; end if;
    return new;
  end if;
  if eid is null or new.employee_id <> eid then raise exception 'Unauthorized leave request'; end if;
  if new.status <> 'pending' then raise exception 'New leave request must be pending'; end if;
  select * into t from public.leave_types where code = new.leave_type and active;
  if not found then raise exception 'Choose a valid leave type'; end if;
  if new.duration = 'half' and not t.allow_half_day then raise exception '% leave can’t be taken as a half day', t.name; end if;
  if t.min_notice_days > 0 and new.start_date < v_today + t.min_notice_days then
    raise exception '% leave needs % day(s) notice', t.name, t.min_notice_days;
  end if;
  calculated := private.calculate_leave_days(new.start_date, new.end_date, new.duration);
  if calculated <= 0 then raise exception 'Selected dates contain no working leave days'; end if;
  if t.max_consecutive_days is not null and calculated > t.max_consecutive_days then
    raise exception '% leave can be at most % working day(s) at a time', t.name, t.max_consecutive_days;
  end if;
  if t.annual_limit is not null then
    select coalesce(sum(lr.days), 0) into used from public.leave_requests lr
    where lr.employee_id = eid and lower(lr.leave_type) = t.code and lr.status in ('pending','approved')
      and extract(year from lr.start_date) = extract(year from new.start_date);
    if used + calculated > t.annual_limit then
      raise exception 'This would take you past the % % day(s) allowed this year (% already used or requested)',
        t.annual_limit, lower(t.name), used;
    end if;
  end if;
  if exists (
    select 1 from public.leave_requests lr
    where lr.employee_id = eid and lr.status in ('pending','approved') and lr.id <> new.id
      and lr.start_date <= new.end_date and lr.end_date >= new.start_date
  ) then
    raise exception 'A pending or approved leave already exists for part of these dates';
  end if;
  select leave_chain into v_chain from public.approval_settings where id;
  select m.id into v_mgr from public.employees e join public.employees m on m.id = e.manager_id
  where e.id = eid and m.status = 'active' and m.id <> eid;
  perform private.ensure_leave_ledgers(new.start_date);
  new.days := calculated;
  new.paid_days := 0;
  new.unpaid_days := 0;
  new.manager_id := v_mgr;
  new.manager_status := case when coalesce(v_chain, 'admin') = 'admin' or v_mgr is null then 'skipped' else 'pending' end;
  new.manager_note := null; new.manager_reviewed_at := null; new.cancelled_at := null;
  new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
  new.updated_at := now();
  return new;
end $$;
create or replace function private.handle_leave_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ledger public.leave_ledger%rowtype;
  available numeric;
  paid numeric;
  unpaid numeric;
  v_paid_type boolean;
  v_rpc boolean := coalesce(current_setting('sigma.leave_rpc', true), '') = 'on';
begin
  if NEW.status = OLD.status then
    if not v_rpc and not private.is_admin() then
      NEW.manager_id := OLD.manager_id; NEW.manager_status := OLD.manager_status;
      NEW.manager_note := OLD.manager_note; NEW.manager_reviewed_at := OLD.manager_reviewed_at;
      NEW.cancelled_at := OLD.cancelled_at;
    end if;
    NEW.updated_at := now();
    return NEW;
  end if;
  if not (private.is_admin() or v_rpc) then raise exception 'Only an approver can review leave'; end if;
  if OLD.status <> 'pending' then raise exception 'Only pending leave requests can be reviewed'; end if;
  if NEW.status = 'cancelled' then
    NEW.cancelled_at := now(); NEW.paid_days := 0; NEW.unpaid_days := 0;
    NEW.updated_at := now();
    return NEW;
  end if;
  NEW.reviewed_at := now();
  NEW.reviewed_by := (select auth.uid());
  if NEW.manager_status = 'pending' and private.is_admin() then NEW.manager_status := 'skipped'; end if;
  if NEW.status = 'approved' then
    perform private.leave_check_document(NEW);
    perform private.ensure_leave_ledgers(NEW.start_date);
    select * into ledger from public.leave_ledger l
      where l.employee_id = NEW.employee_id and l.period_start = date_trunc('month', NEW.start_date)::date for update;
    available := greatest(0, ledger.opening_balance + ledger.accrual + ledger.adjustment - ledger.paid_used);
    select lt.is_paid into v_paid_type from public.leave_types lt where lt.code = lower(NEW.leave_type);
    if not coalesce(v_paid_type, lower(NEW.leave_type) <> 'unpaid') then
      paid := 0; unpaid := NEW.days;
    else
      paid := least(available, NEW.days); unpaid := greatest(0, NEW.days - paid);
    end if;
    update public.leave_ledger
      set paid_used = paid_used + paid, unpaid_used = unpaid_used + unpaid,
          closing_balance = greatest(0, opening_balance + accrual + adjustment - (paid_used + paid)), updated_at = now()
      where id = ledger.id;
    NEW.paid_days := paid;
    NEW.unpaid_days := unpaid;
  elsif NEW.status = 'rejected' then
    NEW.paid_days := 0;
    NEW.unpaid_days := 0;
  else
    raise exception 'Invalid leave review status';
  end if;
  NEW.updated_at := now();
  return NEW;
end $$;
create or replace function public.trg_notify_leave_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_emp record;
  r record;
  v_msg text;
begin
  select id, name, profile_id into v_emp from public.employees where id = NEW.employee_id;
  v_msg := coalesce(v_emp.name, 'An employee') || ' · ' || NEW.days || ' day(s) of ' || NEW.leave_type || ' leave, '
           || to_char(NEW.start_date, 'DD Mon') || case when NEW.end_date <> NEW.start_date then ' – ' || to_char(NEW.end_date, 'DD Mon') else '' end;
  if TG_OP = 'INSERT' then
    if NEW.manager_status = 'pending' and NEW.manager_id is not null then
      perform private.notify_employee(NEW.manager_id, 'leave', 'Leave request to review', v_msg, '/emp-approvals', 'leave_submit_' || NEW.id);
    else
      for r in select id from public.profiles where role = 'admin' loop
        perform private.notify(r.id, 'leave', 'New leave request', v_msg, '/admin-requests?tab=leave', 'leave_submit_' || NEW.id,
          jsonb_build_object('leave_id', NEW.id));
      end loop;
    end if;
    return NEW;
  end if;
  if NEW.status = 'pending' and OLD.manager_status = 'pending' and NEW.manager_status = 'approved' then
    for r in select id from public.profiles where role = 'admin' loop
      perform private.notify(r.id, 'leave', 'Leave approved by manager', v_msg || ' — ready for final approval.',
        '/admin-requests?tab=leave', 'leave_mgr_ok_' || NEW.id, jsonb_build_object('leave_id', NEW.id));
    end loop;
  end if;
  if OLD.status = 'pending' and NEW.status in ('approved','rejected') and v_emp.profile_id is not null then
    perform private.notify(v_emp.profile_id, 'leave', 'Leave request ' || NEW.status,
      'Your leave for ' || to_char(NEW.start_date, 'DD Mon') ||
      case when NEW.end_date <> NEW.start_date then ' – ' || to_char(NEW.end_date, 'DD Mon') else '' end || ' was ' || NEW.status || '.' ||
      coalesce(' Note: ' || coalesce(NEW.review_note, NEW.manager_note), ''),
      '/emp-leave', 'leave_review_' || NEW.id || '_' || NEW.status, jsonb_build_object('leave_id', NEW.id));
  end if;
  return NEW;
end $$;
create or replace function public.leave_manager_review(p_leave_id uuid, p_decision text, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests; v_chain text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from public.leave_requests where id = p_leave_id for update;
  perform private.require(found, 'Leave request not found');
  perform private.require(r.manager_id is not null and r.manager_id = private.current_employee_id(), 'Only the reporting manager can review this request');
  perform private.require(r.status = 'pending' and r.manager_status = 'pending', 'This request is no longer waiting for you');
  perform private.require(p_decision in ('approved','rejected'), 'Choose approve or reject');
  perform private.require(p_decision = 'approved' or v_note is not null, 'Give a reason for rejecting');
  perform private.require(v_note is null or length(v_note) <= 1000, 'Note is too long');
  select leave_chain into v_chain from public.approval_settings where id;
  if p_decision = 'approved' then perform private.leave_check_document(r); end if;
  perform set_config('sigma.leave_rpc', 'on', true);
  update public.leave_requests set
    manager_status = p_decision, manager_note = v_note, manager_reviewed_at = now(),
    status = case when p_decision = 'rejected' then 'rejected'
                  when v_chain = 'manager' then 'approved' else status end,
    review_note = case when p_decision = 'rejected' or v_chain = 'manager' then v_note else review_note end
  where id = r.id;
  perform set_config('sigma.leave_rpc', '', true);
  return case when p_decision = 'rejected' then 'rejected' when v_chain = 'manager' then 'approved' else 'forwarded' end;
end $$;
create or replace function public.leave_admin_review(p_leave_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.require(private.is_admin(), 'Only an administrator can give final approval');
  select * into r from public.leave_requests where id = p_leave_id for update;
  perform private.require(found, 'Leave request not found');
  perform private.require(r.status = 'pending', 'This request was already reviewed');
  perform private.require(p_decision in ('approved','rejected'), 'Choose approve or reject');
  perform private.require(p_decision = 'approved' or v_note is not null, 'Give a reason for rejecting');
  perform private.require(v_note is null or length(v_note) <= 1000, 'Note is too long');
  update public.leave_requests set status = p_decision, review_note = v_note where id = r.id;
end $$;
create or replace function public.leave_cancel(p_leave_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests;
begin
  select * into r from public.leave_requests where id = p_leave_id for update;
  perform private.require(found and r.employee_id = private.current_employee_id(), 'Leave request not found');
  perform private.require(r.status = 'pending', 'Only a pending request can be withdrawn');
  perform set_config('sigma.leave_rpc', 'on', true);
  update public.leave_requests set status = 'cancelled' where id = r.id;
  perform set_config('sigma.leave_rpc', '', true);
end $$;
create or replace function public.leave_team_requests()
returns table (id uuid, employee_id uuid, employee_name text, designation text, avatar_url text, leave_type text,
  start_date date, end_date date, duration text, days numeric, reason text, status text, manager_status text,
  manager_note text, review_note text, has_document boolean, created_at timestamptz, available_paid numeric)
language sql stable security definer set search_path = '' as $$
  select lr.id, lr.employee_id, e.name, d.name, e.avatar_url, lr.leave_type, lr.start_date, lr.end_date, lr.duration, lr.days,
         lr.reason, lr.status, lr.manager_status, lr.manager_note, lr.review_note, private.leave_has_document(lr.id), lr.created_at,
         (select greatest(0, l.opening_balance + l.accrual + l.adjustment - l.paid_used) from public.leave_ledger l
           where l.employee_id = lr.employee_id and l.period_start = date_trunc('month', lr.start_date)::date)
  from public.leave_requests lr
  join public.employees e on e.id = lr.employee_id
  left join public.designations d on d.id = e.designation_id
  where lr.manager_id = private.current_employee_id()
    and (lr.status = 'pending' or lr.updated_at > now() - interval '60 days')
  order by (lr.status = 'pending' and lr.manager_status = 'pending') desc, lr.start_date
$$;
alter table public.files drop constraint if exists files_parent_type_check;
alter table public.files add constraint files_parent_type_check check (parent_type in
  ('contract','deliverable','dependency','task','invoice','payment','employee','client','project','leave'));
create or replace function private.can_read_file(p_file_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  f public.files;
  d public.deliverables;
  v_emp uuid := private.current_employee_id();
begin
  select * into f from public.files where id = p_file_id;
  if not found then return false; end if;
  if private.is_admin() then return true; end if;
  if f.deleted_at is not null then return false; end if;
  if f.uploaded_by = (select auth.uid()) then return true; end if;
  if f.project_id is not null and private.can_manage_project(f.project_id) then return true; end if;
  if f.parent_type in ('payment','invoice') and private.has_permission('payment.record') then return true; end if;
  if v_emp is not null then
    if f.parent_type = 'deliverable' and exists (select 1 from public.deliverables x where x.id = f.parent_id and x.responsible_id = v_emp) then return true; end if;
    if f.parent_type = 'dependency' and exists (select 1 from public.deliverable_dependencies dd join public.deliverables x on x.id = dd.deliverable_id
                                                where dd.id = f.parent_id and x.responsible_id = v_emp) then return true; end if;
    if f.parent_type = 'task' and exists (select 1 from public.tasks t where t.id = f.parent_id and (t.assigned_to = v_emp or t.assigned_by = v_emp)) then return true; end if;
    if f.parent_type = 'leave' and exists (select 1 from public.leave_requests lr where lr.id = f.parent_id and (lr.employee_id = v_emp or lr.manager_id = v_emp)) then return true; end if;
  end if;
  if f.client_id is null or f.client_id is distinct from private.current_client_id() or f.visibility <> 'client' then
    return false;
  end if;
  if f.project_id is not null and not private.is_client_of_project(f.project_id) then return false; end if;
  case f.parent_type
    when 'deliverable' then
      select * into d from public.deliverables where id = f.parent_id;
      if not found or d.deleted_at is not null or d.status = 'Draft' then return false; end if;
      if f.is_final then
        return d.status = 'Ready for Download'
           and d.lock_state in ('unlocked','override_unlocked')
           and private.has_permission('client.deliverable.download');
      end if;
      return private.has_permission('client.deliverable.view');
    when 'contract' then
      return exists (select 1 from public.contracts k where k.id = f.parent_id and k.status <> 'Draft' and k.deleted_at is null);
    when 'dependency', 'payment' then
      return true;
    when 'invoice' then
      return private.has_permission('client.billing.view');
    when 'project', 'client' then
      return true;
    else
      return false;
  end case;
end $$;
create or replace function public.attach_file(p_storage_path text, p_parent_type text, p_parent_id uuid, p_name text,
  p_mime_type text default null, p_size_bytes bigint default null, p_visibility text default 'internal',
  p_is_final boolean default false, p_replaces_file_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_client_user uuid := private.current_client_id();
  v_project uuid; v_client uuid; v_group uuid; v_version int := 1; v_id uuid;
  v_allowed boolean := false; v_prev public.files;
begin
  perform private.require(v_uid is not null, 'Authentication required');
  perform private.require(p_storage_path like v_uid::text || '/%', 'Upload path is not owned by you');
  perform private.require(exists (select 1 from storage.objects o where o.bucket_id = 'sigma-files' and o.name = p_storage_path
    and o.owner_id = v_uid::text), 'Uploaded object not found');
  perform private.require(not exists (select 1 from public.files where storage_path = p_storage_path), 'File already attached');
  perform private.require(p_visibility in ('internal','client'), 'Invalid visibility');
  case p_parent_type
    when 'deliverable' then
      select project_id, client_id into v_project, v_client from public.deliverables where id = p_parent_id and deleted_at is null;
      v_allowed := v_client_user is null and (private.project_permission(v_project, 'deliverable.upload')
        or exists (select 1 from public.deliverables d where d.id = p_parent_id and d.responsible_id = private.current_employee_id()));
    when 'dependency' then
      select project_id, client_id into v_project, v_client from public.deliverable_dependencies where id = p_parent_id;
      v_allowed := (v_client_user is not null and v_client_user = v_client and private.has_permission('client.dependency.upload'))
        or (v_client_user is null and private.can_manage_project(v_project));
      if v_client_user is not null then p_visibility := 'client'; p_is_final := false; end if;
    when 'payment' then
      select project_id, client_id into v_project, v_client from public.payment_installments where id = p_parent_id and deleted_at is null;
      v_allowed := (v_client_user is not null and v_client_user = v_client and private.has_permission('client.payment.submit'))
        or (v_client_user is null and private.has_permission('payment.record'));
      if v_client_user is not null then p_visibility := 'client'; end if;
      p_is_final := false;
    when 'invoice' then
      select project_id, client_id into v_project, v_client from public.payment_installments where id = p_parent_id and deleted_at is null;
      v_allowed := v_client_user is null and private.has_permission('invoice.generate');
    when 'contract' then
      select project_id, client_id into v_project, v_client from public.contracts where id = p_parent_id and deleted_at is null;
      v_allowed := v_client_user is null and private.has_permission('contract.create');
    when 'task' then
      select project_id into v_project from public.tasks where id = p_parent_id;
      select client_id into v_client from public.projects where id = v_project;
      v_allowed := v_client_user is null and exists (select 1 from public.tasks t where t.id = p_parent_id
        and (private.is_admin() or t.assigned_to = private.current_employee_id() or t.assigned_by = private.current_employee_id()));
      p_visibility := 'internal';
    when 'leave' then
      v_allowed := v_client_user is null and exists (select 1 from public.leave_requests lr where lr.id = p_parent_id
        and lr.status = 'pending' and (private.is_admin() or lr.employee_id = private.current_employee_id()));
      v_project := null; v_client := null; p_visibility := 'internal'; p_is_final := false;
    else
      v_allowed := false;
  end case;
  perform private.require(v_allowed, 'You are not allowed to attach files here');
  if p_replaces_file_id is not null then
    select * into v_prev from public.files where id = p_replaces_file_id and deleted_at is null;
    perform private.require(found and v_prev.parent_type = p_parent_type and v_prev.parent_id = p_parent_id, 'Invalid file to replace');
    perform pg_advisory_xact_lock(hashtext('file-group:' || v_prev.file_group_id::text));
    v_group := v_prev.file_group_id;
    select max(version_no) + 1 into v_version from public.files where file_group_id = v_group;
  else
    v_group := gen_random_uuid();
  end if;
  insert into public.files(file_group_id, version_no, parent_type, parent_id, client_id, project_id, name, mime_type,
    size_bytes, storage_path, visibility, is_final, uploaded_by)
  values (v_group, v_version, p_parent_type, p_parent_id, v_client, v_project, left(btrim(p_name), 255), p_mime_type,
    p_size_bytes, p_storage_path, p_visibility, coalesce(p_is_final, false), v_uid)
  returning id into v_id;
  return v_id;
end $$;
select set_config('sigma.leave_rpc', 'on', true);
update public.leave_requests set manager_status = 'skipped' where manager_status is null;
select set_config('sigma.leave_rpc', '', true);
create or replace trigger trg_leave_request_notify after insert or update of status, manager_status on public.leave_requests
  for each row execute function public.trg_notify_leave_request();
drop policy if exists leave_types_select on public.leave_types;
create policy leave_types_select on public.leave_types for select to authenticated using (true);
drop policy if exists leave_types_admin_write on public.leave_types;
create policy leave_types_admin_write on public.leave_types for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
drop policy if exists approval_settings_select on public.approval_settings;
create policy approval_settings_select on public.approval_settings for select to authenticated using (true);
drop policy if exists approval_settings_admin_update on public.approval_settings;
create policy approval_settings_admin_update on public.approval_settings for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
drop policy if exists leave_manager_select on public.leave_requests;
create policy leave_manager_select on public.leave_requests for select to authenticated
  using (manager_id is not null and manager_id = private.current_employee_id());
revoke all on public.leave_types, public.approval_settings from anon;
revoke truncate, trigger, references, delete on public.leave_types, public.approval_settings from authenticated;
revoke insert on public.approval_settings from authenticated;
grant select, insert, update on public.leave_types to authenticated;
grant select, update on public.approval_settings to authenticated;
revoke execute on function private.leave_has_document(uuid), private.leave_check_document(public.leave_requests) from public, anon;
grant execute on function private.leave_has_document(uuid), private.leave_check_document(public.leave_requests) to authenticated;
revoke execute on function public.leave_manager_review(uuid, text, text), public.leave_admin_review(uuid, text, text),
  public.leave_cancel(uuid), public.leave_team_requests() from public, anon;
grant execute on function public.leave_manager_review(uuid, text, text), public.leave_admin_review(uuid, text, text),
  public.leave_cancel(uuid), public.leave_team_requests() to authenticated;
create or replace trigger leave_types_updated_at before update on public.leave_types for each row execute function private.create_updated_at_trigger();
create or replace trigger trg_audit_leave_types after insert or update or delete on public.leave_types for each row execute function private.audit_row_change();
create or replace trigger trg_audit_approval_settings after update on public.approval_settings for each row execute function private.audit_row_change();
set local lock_timeout = '5s';
create table if not exists public.performance_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  period_type text not null check (period_type in ('monthly','quarterly','half_yearly','annual')),
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft','open','closed')),
  self_review_due date,
  created_by uuid references public.profiles(id) on delete set null,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create table if not exists public.kras (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.performance_cycles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  title text not null check (length(btrim(title)) between 2 and 160),
  description text check (description is null or length(description) <= 2000),
  measurement text check (measurement is null or length(measurement) <= 300),
  target text check (target is null or length(target) <= 300),
  weightage numeric(5,2) not null check (weightage > 0 and weightage <= 100),
  actual text check (actual is null or length(actual) <= 500),
  self_score numeric(5,2) check (self_score is null or self_score between 0 and 100),
  self_comment text check (self_comment is null or length(self_comment) <= 2000),
  manager_score numeric(5,2) check (manager_score is null or manager_score between 0 and 100),
  manager_comment text check (manager_comment is null or length(manager_comment) <= 2000),
  final_score numeric(5,2) check (final_score is null or final_score between 0 and 100),
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kras_cycle_employee_idx on public.kras(cycle_id, employee_id);
create index if not exists kras_employee_idx on public.kras(employee_id);
create table if not exists public.performance_reviews (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.performance_cycles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  manager_id uuid references public.employees(id) on delete set null,
  status text not null default 'self_review' check (status in ('self_review','manager_review','finalized')),
  self_summary text check (self_summary is null or length(self_summary) <= 4000),
  manager_summary text check (manager_summary is null or length(manager_summary) <= 4000),
  strengths text check (strengths is null or length(strengths) <= 2000),
  improvements text check (improvements is null or length(improvements) <= 2000),
  overall_score numeric(5,2) check (overall_score is null or overall_score between 0 and 100),
  rating text,
  self_submitted_at timestamptz,
  manager_submitted_at timestamptz,
  finalized_at timestamptz,
  finalized_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, employee_id)
);
create index if not exists performance_reviews_employee_idx on public.performance_reviews(employee_id);
create index if not exists performance_reviews_manager_idx on public.performance_reviews(manager_id) where manager_id is not null;
create table if not exists public.employee_milestones (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  kind text not null check (kind in ('promotion','role_change','recognition','warning','improvement_plan','training','certification','note')),
  title text not null check (length(btrim(title)) between 2 and 160),
  details text check (details is null or length(details) <= 4000),
  effective_date date not null,
  from_value text check (from_value is null or length(from_value) <= 160),
  to_value text check (to_value is null or length(to_value) <= 160),
  visible_to_employee boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employee_milestones_employee_idx on public.employee_milestones(employee_id, effective_date desc);
create table if not exists public.performance_settings (
  id boolean primary key default true check (id),
  promotion_min_score numeric(5,2) not null default 80 check (promotion_min_score between 0 and 100),
  promotion_min_reviews integer not null default 2 check (promotion_min_reviews between 1 and 12),
  promotion_min_months integer not null default 12 check (promotion_min_months between 0 and 120),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.performance_settings(id) values (true) on conflict (id) do nothing;
alter table public.performance_cycles enable row level security;
alter table public.kras enable row level security;
alter table public.performance_reviews enable row level security;
alter table public.employee_milestones enable row level security;
alter table public.performance_settings enable row level security;
create or replace function private.can_manage_performance()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.has_permission('kra.manage')
$$;
create or replace function private.is_manager_of(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e
                 where e.id = p_employee_id and e.manager_id is not null
                   and e.manager_id = private.current_employee_id())
$$;
create or replace function private.rating_for(p_score numeric)
returns text language sql immutable set search_path = '' as $$
  select case when p_score is null then null
              when p_score >= 90 then 'Outstanding'
              when p_score >= 75 then 'Exceeds expectations'
              when p_score >= 60 then 'Meets expectations'
              when p_score >= 40 then 'Needs improvement'
              else 'Unsatisfactory' end
$$;
create or replace function private.review_weighted_score(p_cycle uuid, p_employee uuid, p_which text)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when sum(k.weightage) > 0 and count(*) = count(
           case p_which when 'self' then k.self_score when 'manager' then k.manager_score else coalesce(k.final_score, k.manager_score, k.self_score) end)
         then round(sum(k.weightage * case p_which when 'self' then k.self_score when 'manager' then k.manager_score
                                       else coalesce(k.final_score, k.manager_score, k.self_score) end) / sum(k.weightage), 2)
         end
  from public.kras k where k.cycle_id = p_cycle and k.employee_id = p_employee
$$;
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin NEW.updated_at := now(); return NEW; end $$;
create or replace function private.guard_kra_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text; v_review text;
begin
  select status into v_status from public.performance_cycles where id = coalesce(NEW.cycle_id, OLD.cycle_id);
  select status into v_review from public.performance_reviews
    where cycle_id = coalesce(NEW.cycle_id, OLD.cycle_id) and employee_id = coalesce(NEW.employee_id, OLD.employee_id);
  if coalesce(current_setting('sigma.perf_rpc', true), '') = 'on' then
    return coalesce(NEW, OLD);
  end if;
  if v_status = 'closed' or v_review = 'finalized' then raise exception 'This review is closed'; end if;
  if TG_OP in ('INSERT','DELETE') and v_status <> 'draft' then
    raise exception 'KRAs can only be added or removed while the cycle is a draft';
  end if;
  if TG_OP = 'UPDATE' and v_status <> 'draft' and NEW.weightage is distinct from OLD.weightage then
    raise exception 'Weightage is fixed once the cycle is open';
  end if;
  if TG_OP = 'UPDATE' then
    NEW.self_score := OLD.self_score; NEW.self_comment := OLD.self_comment; NEW.actual := OLD.actual;
    NEW.manager_score := OLD.manager_score; NEW.manager_comment := OLD.manager_comment;
    NEW.final_score := OLD.final_score; NEW.created_by := OLD.created_by;
    NEW.cycle_id := OLD.cycle_id; NEW.employee_id := OLD.employee_id;
  elsif TG_OP = 'INSERT' then
    NEW.self_score := null; NEW.self_comment := null; NEW.actual := null;
    NEW.manager_score := null; NEW.manager_comment := null; NEW.final_score := null;
    NEW.created_by := auth.uid();
  end if;
  return coalesce(NEW, OLD);
end $$;
create or replace trigger performance_cycles_updated_at before update on public.performance_cycles for each row execute function private.touch_updated_at();
create or replace trigger kras_updated_at before update on public.kras for each row execute function private.touch_updated_at();
create or replace trigger performance_reviews_updated_at before update on public.performance_reviews for each row execute function private.touch_updated_at();
create or replace trigger employee_milestones_updated_at before update on public.employee_milestones for each row execute function private.touch_updated_at();
create or replace trigger kras_guard before insert or update or delete on public.kras for each row execute function private.guard_kra_write();
create or replace trigger trg_audit_performance_cycles after insert or update or delete on public.performance_cycles for each row execute function private.audit_row_change();
create or replace trigger trg_audit_kras after insert or update or delete on public.kras for each row execute function private.audit_row_change();
create or replace trigger trg_audit_performance_reviews after insert or update or delete on public.performance_reviews for each row execute function private.audit_row_change();
create or replace trigger trg_audit_employee_milestones after insert or update or delete on public.employee_milestones for each row execute function private.audit_row_change();
create or replace function public.performance_open_cycle(p_cycle_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.performance_cycles; r record; n int := 0; v_bad text;
begin
  perform private.require(private.can_manage_performance(), 'Only HR or an administrator can open a review cycle');
  select * into c from public.performance_cycles where id = p_cycle_id for update;
  perform private.require(found, 'Cycle not found');
  perform private.require(c.status = 'draft', 'This cycle is already open');
  perform private.require(exists (select 1 from public.kras where cycle_id = c.id), 'Add KRAs before opening the cycle');
  select string_agg(e.name || ' (' || trim(to_char(s.total, 'FM990.##')) || '%)', ', ') into v_bad
  from (select employee_id, sum(weightage) total from public.kras where cycle_id = c.id group by employee_id) s
  join public.employees e on e.id = s.employee_id
  where s.total <> 100;
  perform private.require(v_bad is null, 'Weightage must add up to 100% for each person: ' || coalesce(v_bad, ''));
  perform set_config('sigma.perf_rpc', 'on', true);
  update public.performance_cycles set status = 'open', opened_at = now() where id = c.id;
  for r in select distinct k.employee_id, e.manager_id from public.kras k join public.employees e on e.id = k.employee_id where k.cycle_id = c.id loop
    insert into public.performance_reviews(cycle_id, employee_id, manager_id, status)
    values (c.id, r.employee_id, r.manager_id, 'self_review')
    on conflict (cycle_id, employee_id) do nothing;
    perform private.notify_employee(r.employee_id, 'system', 'Performance review open',
      c.name || ': rate yourself on your KRAs' || coalesce(' by ' || to_char(c.self_review_due, 'DD Mon'), '') || '.',
      '/emp-performance', 'perf_open_' || c.id || '_' || r.employee_id);
    n := n + 1;
  end loop;
  perform set_config('sigma.perf_rpc', '', true);
  return n;
end $$;
create or replace function public.performance_self_assess(p_kra_id uuid, p_actual text, p_score numeric, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare k public.kras; rv public.performance_reviews;
begin
  select * into k from public.kras where id = p_kra_id for update;
  perform private.require(found and k.employee_id = private.current_employee_id(), 'KRA not found');
  select * into rv from public.performance_reviews where cycle_id = k.cycle_id and employee_id = k.employee_id;
  perform private.require(found and rv.status = 'self_review', 'Your self-assessment is already submitted');
  perform private.require(p_score is not null and p_score between 0 and 100, 'Score must be between 0 and 100');
  perform set_config('sigma.perf_rpc', 'on', true);
  update public.kras set actual = nullif(btrim(coalesce(p_actual, '')), ''), self_score = round(p_score, 2),
    self_comment = nullif(btrim(coalesce(p_comment, '')), '') where id = k.id;
  perform set_config('sigma.perf_rpc', '', true);
end $$;
create or replace function public.performance_submit_self(p_review_id uuid, p_summary text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare rv public.performance_reviews; v_missing int; v_name text; r record;
begin
  select * into rv from public.performance_reviews where id = p_review_id for update;
  perform private.require(found and rv.employee_id = private.current_employee_id(), 'Review not found');
  perform private.require(rv.status = 'self_review', 'Already submitted');
  select count(*) into v_missing from public.kras where cycle_id = rv.cycle_id and employee_id = rv.employee_id and self_score is null;
  perform private.require(v_missing = 0, 'Score every KRA before submitting (' || v_missing || ' left)');
  perform set_config('sigma.perf_rpc', 'on', true);
  update public.performance_reviews set status = 'manager_review', self_summary = nullif(btrim(coalesce(p_summary, '')), ''),
    self_submitted_at = now() where id = rv.id;
  perform set_config('sigma.perf_rpc', '', true);
  select name into v_name from public.employees where id = rv.employee_id;
  if rv.manager_id is not null then
    perform private.notify_employee(rv.manager_id, 'system', 'Self-review submitted',
      coalesce(v_name, 'A team member') || ' finished their self-assessment. Add your scores.', '/emp-performance', 'perf_self_' || rv.id);
  else
    for r in select id from public.profiles where role = 'admin' loop
      perform private.notify(r.id, 'system', 'Self-review submitted', coalesce(v_name, 'An employee') || ' finished their self-assessment.',
        '/admin-performance', 'perf_self_' || rv.id, jsonb_build_object('review_id', rv.id));
    end loop;
  end if;
end $$;
create or replace function public.performance_manager_assess(p_kra_id uuid, p_score numeric, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare k public.kras; rv public.performance_reviews;
begin
  select * into k from public.kras where id = p_kra_id for update;
  perform private.require(found, 'KRA not found');
  perform private.require(private.is_manager_of(k.employee_id) or private.can_manage_performance(), 'Only the reporting manager can score this KRA');
  perform private.require(k.employee_id is distinct from private.current_employee_id(), 'You can’t score your own KRAs as manager');
  select * into rv from public.performance_reviews where cycle_id = k.cycle_id and employee_id = k.employee_id;
  perform private.require(found and rv.status = 'manager_review', 'Waiting for the self-assessment first');
  perform private.require(p_score is not null and p_score between 0 and 100, 'Score must be between 0 and 100');
  perform set_config('sigma.perf_rpc', 'on', true);
  update public.kras set manager_score = round(p_score, 2), manager_comment = nullif(btrim(coalesce(p_comment, '')), '') where id = k.id;
  perform set_config('sigma.perf_rpc', '', true);
end $$;
create or replace function public.performance_submit_manager(p_review_id uuid, p_summary text, p_strengths text default null, p_improvements text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare rv public.performance_reviews; v_missing int; v_name text; r record;
begin
  select * into rv from public.performance_reviews where id = p_review_id for update;
  perform private.require(found, 'Review not found');
  perform private.require(private.is_manager_of(rv.employee_id) or private.can_manage_performance(), 'Only the reporting manager can submit this review');
  perform private.require(rv.employee_id is distinct from private.current_employee_id(), 'You can’t review yourself');
  perform private.require(rv.status = 'manager_review', 'This review isn’t waiting for the manager');
  select count(*) into v_missing from public.kras where cycle_id = rv.cycle_id and employee_id = rv.employee_id and manager_score is null;
  perform private.require(v_missing = 0, 'Score every KRA before submitting (' || v_missing || ' left)');
  perform private.require(length(btrim(coalesce(p_summary, ''))) > 0, 'Write a short summary');
  perform set_config('sigma.perf_rpc', 'on', true);
  update public.performance_reviews set manager_summary = btrim(p_summary),
    strengths = nullif(btrim(coalesce(p_strengths, '')), ''), improvements = nullif(btrim(coalesce(p_improvements, '')), ''),
    manager_submitted_at = now(),
    overall_score = private.review_weighted_score(rv.cycle_id, rv.employee_id, 'manager')
  where id = rv.id;
  perform set_config('sigma.perf_rpc', '', true);
  select name into v_name from public.employees where id = rv.employee_id;
  for r in select id from public.profiles where role = 'admin' loop
    perform private.notify(r.id, 'system', 'Review ready to finalize', coalesce(v_name, 'An employee') || '’s manager review is in.',
      '/admin-performance', 'perf_mgr_' || rv.id, jsonb_build_object('review_id', rv.id));
  end loop;
end $$;
create or replace function public.performance_finalize(p_review_id uuid, p_overrides jsonb default '{}'::jsonb)
returns numeric language plpgsql security definer set search_path = '' as $$
declare rv public.performance_reviews; v_score numeric; v_missing int; c public.performance_cycles;
begin
  perform private.require(private.can_manage_performance(), 'Only HR or an administrator can finalize a review');
  select * into rv from public.performance_reviews where id = p_review_id for update;
  perform private.require(found, 'Review not found');
  perform private.require(rv.status <> 'finalized', 'Already finalized');
  perform private.require(rv.employee_id is distinct from private.current_employee_id(), 'You can’t finalize your own review');
  select * into c from public.performance_cycles where id = rv.cycle_id;
  perform private.require(c.status = 'open', 'The cycle must be open');
  perform set_config('sigma.perf_rpc', 'on', true);
  update public.kras k set final_score = round(least(100, greatest(0,
      coalesce((p_overrides ->> k.id::text)::numeric, k.manager_score, k.self_score))), 2)
  where k.cycle_id = rv.cycle_id and k.employee_id = rv.employee_id;
  select count(*) into v_missing from public.kras where cycle_id = rv.cycle_id and employee_id = rv.employee_id and final_score is null;
  perform private.require(v_missing = 0, 'Some KRAs have no score yet');
  v_score := private.review_weighted_score(rv.cycle_id, rv.employee_id, 'final');
  update public.performance_reviews set status = 'finalized', overall_score = v_score, rating = private.rating_for(v_score),
    finalized_at = now(), finalized_by = auth.uid() where id = rv.id;
  perform set_config('sigma.perf_rpc', '', true);
  perform private.notify_employee(rv.employee_id, 'system', 'Performance review finalized',
    c.name || ': ' || trim(to_char(v_score, 'FM990.0')) || '% · ' || private.rating_for(v_score) || '.', '/emp-performance', 'perf_final_' || rv.id);
  return v_score;
end $$;
create or replace function public.performance_close_cycle(p_cycle_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.performance_cycles; v_open int;
begin
  perform private.require(private.can_manage_performance(), 'Only HR or an administrator can close a cycle');
  select * into c from public.performance_cycles where id = p_cycle_id for update;
  perform private.require(found and c.status = 'open', 'Only an open cycle can be closed');
  select count(*) into v_open from public.performance_reviews where cycle_id = c.id and status <> 'finalized';
  perform private.require(v_open = 0, 'Finalize every review first (' || v_open || ' left)');
  perform set_config('sigma.perf_rpc', 'on', true);
  update public.performance_cycles set status = 'closed', closed_at = now() where id = c.id;
  perform set_config('sigma.perf_rpc', '', true);
end $$;
create or replace function public.performance_copy_kras(p_cycle_id uuid, p_from_employee uuid, p_designation_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.performance_cycles; e record; n int := 0;
begin
  perform private.require(private.can_manage_performance(), 'Only HR or an administrator can set KRAs');
  select * into c from public.performance_cycles where id = p_cycle_id;
  perform private.require(found and c.status = 'draft', 'KRAs can only be copied while the cycle is a draft');
  perform private.require(exists (select 1 from public.kras where cycle_id = c.id and employee_id = p_from_employee), 'Nothing to copy');
  for e in select id from public.employees where designation_id = p_designation_id and status = 'active' and id <> p_from_employee loop
    delete from public.kras where cycle_id = c.id and employee_id = e.id;
    insert into public.kras(cycle_id, employee_id, title, description, measurement, target, weightage, sort_order)
    select c.id, e.id, title, description, measurement, target, weightage, sort_order from public.kras
    where cycle_id = c.id and employee_id = p_from_employee;
    n := n + 1;
  end loop;
  return n;
end $$;
create or replace function public.performance_promotion_candidates()
returns table (employee_id uuid, name text, designation text, months_in_role integer, reviews integer, average_score numeric, last_promotion date)
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.performance_settings where id),
  last_promo as (
    select m.employee_id, max(m.effective_date) d from public.employee_milestones m where m.kind = 'promotion' group by m.employee_id
  ),
  recent as (
    select r.employee_id, r.overall_score, row_number() over (partition by r.employee_id order by c.end_date desc) rn
    from public.performance_reviews r join public.performance_cycles c on c.id = r.cycle_id
    where r.status = 'finalized' and r.overall_score is not null
  )
  select e.id, e.name, d.name,
         (extract(year from age(current_date, coalesce(lp.d, e.join_date))) * 12 + extract(month from age(current_date, coalesce(lp.d, e.join_date))))::int,
         count(rc.*)::int, round(avg(rc.overall_score), 1), lp.d
  from public.employees e
  cross join s
  left join public.designations d on d.id = e.designation_id
  left join last_promo lp on lp.employee_id = e.id
  join recent rc on rc.employee_id = e.id and rc.rn <= s.promotion_min_reviews
  where private.can_manage_performance() and e.status = 'active'
  group by e.id, e.name, d.name, lp.d, e.join_date, s.promotion_min_reviews, s.promotion_min_score, s.promotion_min_months
  having count(rc.*) >= s.promotion_min_reviews and avg(rc.overall_score) >= s.promotion_min_score
     and (extract(year from age(current_date, coalesce(lp.d, e.join_date))) * 12 + extract(month from age(current_date, coalesce(lp.d, e.join_date)))) >= s.promotion_min_months
  order by avg(rc.overall_score) desc
$$;
create or replace function public.employee_add_milestone(p_employee_id uuid, p_kind text, p_title text, p_effective_date date,
  p_details text default null, p_from text default null, p_to text default null, p_visible boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_hr boolean := private.can_manage_performance();
begin
  perform private.require(p_kind in ('promotion','role_change','recognition','warning','improvement_plan','training','certification','note'), 'Unknown milestone type');
  perform private.require(v_hr or (private.is_manager_of(p_employee_id) and p_kind in ('recognition','training','certification','note')),
    'You can’t add this to the employee’s history');
  perform private.require(length(btrim(coalesce(p_title, ''))) between 2 and 160, 'Give it a title');
  perform private.require(p_effective_date is not null and p_effective_date <= (now() at time zone 'Asia/Kolkata')::date + 366, 'Pick a valid date');
  insert into public.employee_milestones(employee_id, kind, title, details, effective_date, from_value, to_value, visible_to_employee, created_by)
  values (p_employee_id, p_kind, btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), p_effective_date,
          nullif(btrim(coalesce(p_from, '')), ''), nullif(btrim(coalesce(p_to, '')), ''),
          case when v_hr then coalesce(p_visible, true) else true end, auth.uid())
  returning id into v_id;
  if coalesce(p_visible, true) and p_kind in ('promotion','recognition','certification') then
    perform private.notify_employee(p_employee_id, 'system',
      case p_kind when 'promotion' then 'Congratulations on your promotion' when 'recognition' then 'You were recognised' else 'Certification recorded' end,
      btrim(p_title), '/emp-performance', 'milestone_' || v_id);
  end if;
  return v_id;
end $$;
drop policy if exists performance_cycles_select on public.performance_cycles;
create policy performance_cycles_select on public.performance_cycles for select to authenticated
  using (private.can_manage_performance() or status <> 'draft');
drop policy if exists performance_cycles_write on public.performance_cycles;
create policy performance_cycles_write on public.performance_cycles for all to authenticated
  using (private.can_manage_performance()) with check (private.can_manage_performance());
drop policy if exists kras_select on public.kras;
create policy kras_select on public.kras for select to authenticated
  using (private.can_manage_performance()
      or ((employee_id = private.current_employee_id() or private.is_manager_of(employee_id))
          and exists (select 1 from public.performance_cycles c where c.id = cycle_id and c.status <> 'draft')));
drop policy if exists kras_write on public.kras;
create policy kras_write on public.kras for all to authenticated
  using (private.can_manage_performance()) with check (private.can_manage_performance());
drop policy if exists performance_reviews_select on public.performance_reviews;
create policy performance_reviews_select on public.performance_reviews for select to authenticated
  using (private.can_manage_performance() or employee_id = private.current_employee_id() or private.is_manager_of(employee_id));
drop policy if exists employee_milestones_select on public.employee_milestones;
create policy employee_milestones_select on public.employee_milestones for select to authenticated
  using (private.can_manage_performance()
      or (visible_to_employee and (employee_id = private.current_employee_id() or private.is_manager_of(employee_id))));
drop policy if exists employee_milestones_hr_write on public.employee_milestones;
create policy employee_milestones_hr_write on public.employee_milestones for update to authenticated
  using (private.can_manage_performance()) with check (private.can_manage_performance());
drop policy if exists performance_settings_select on public.performance_settings;
create policy performance_settings_select on public.performance_settings for select to authenticated using (true);
drop policy if exists performance_settings_update on public.performance_settings;
create policy performance_settings_update on public.performance_settings for update to authenticated
  using (private.can_manage_performance()) with check (private.can_manage_performance());
revoke all on public.performance_cycles, public.kras, public.performance_reviews, public.employee_milestones, public.performance_settings from anon;
revoke truncate, trigger, references on public.performance_cycles, public.kras, public.performance_reviews, public.employee_milestones, public.performance_settings from authenticated;
grant select, insert, update, delete on public.performance_cycles, public.kras to authenticated;
revoke insert, update, delete on public.performance_reviews from authenticated;
grant select on public.performance_reviews to authenticated;
revoke insert, delete on public.employee_milestones from authenticated;
grant select, update on public.employee_milestones to authenticated;
revoke insert, delete on public.performance_settings from authenticated;
grant select, update on public.performance_settings to authenticated;
revoke execute on function private.can_manage_performance(), private.is_manager_of(uuid), private.review_weighted_score(uuid, uuid, text),
  private.guard_kra_write() from public, anon;
grant execute on function private.can_manage_performance(), private.is_manager_of(uuid), private.rating_for(numeric) to authenticated;
revoke execute on function public.performance_open_cycle(uuid), public.performance_self_assess(uuid, text, numeric, text),
  public.performance_submit_self(uuid, text), public.performance_manager_assess(uuid, numeric, text),
  public.performance_submit_manager(uuid, text, text, text), public.performance_finalize(uuid, jsonb),
  public.performance_close_cycle(uuid), public.performance_copy_kras(uuid, uuid, uuid),
  public.performance_promotion_candidates(),
  public.employee_add_milestone(uuid, text, text, date, text, text, text, boolean) from public, anon;
grant execute on function public.performance_open_cycle(uuid), public.performance_self_assess(uuid, text, numeric, text),
  public.performance_submit_self(uuid, text), public.performance_manager_assess(uuid, numeric, text),
  public.performance_submit_manager(uuid, text, text, text), public.performance_finalize(uuid, jsonb),
  public.performance_close_cycle(uuid), public.performance_copy_kras(uuid, uuid, uuid),
  public.performance_promotion_candidates(),
  public.employee_add_milestone(uuid, text, text, date, text, text, text, boolean) to authenticated;
set local lock_timeout = '5s';
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
create or replace function private.is_deliverable_staff(p_deliverable_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.deliverables d where d.id = p_deliverable_id
                 and private.can_manage_project(d.project_id))
$$;
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
    v_name := 'IRA team';
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
create or replace function private.is_support_staff(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_client_id() is null and exists (
    select 1 from public.support_requests r where r.id = p_request_id
      and (private.is_admin() or private.has_permission('client.edit')
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
    v_name := 'IRA team';
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
  perform private.require(p_assigned_to is null or exists (select 1 from public.employees e where e.id = p_assigned_to and e.status = 'active'
    and (exists (select 1 from public.profiles p where p.id = e.profile_id and p.role = 'admin')
         or (r.project_id is not null and exists (select 1 from public.project_managers pm where pm.project_id = r.project_id and pm.manager_id = e.id)))),
    'Assign to an admin or a manager of this project');
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
set local lock_timeout = '5s';
create or replace function public.client_user_update(p_client_user_id uuid, p_status text default null, p_role text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare cu public.client_users; v_primary uuid; v_admins int; v_ira_admin boolean := private.is_admin();
begin
  select * into cu from public.client_users where id = p_client_user_id for update;
  perform private.require(found, 'User not found');
  perform private.require(v_ira_admin or (private.current_client_id() = cu.client_id and private.has_permission('client.users.manage')),
    'Only your organisation’s administrator can change access');
  perform private.require(cu.profile_id is distinct from auth.uid(), 'You can’t change your own access');
  perform private.require(p_status is null or p_status in ('active','inactive'), 'Unknown status');
  perform private.require(p_role is null or p_role in ('client_admin','client_user'), 'Unknown role');
  perform private.require(not (p_status = 'active' and cu.status = 'invited'), 'They need to finish setting up their account first');
  select profile_id into v_primary from public.clients where id = cu.client_id;
  perform private.require(v_ira_admin or cu.profile_id is distinct from v_primary, 'The primary contact’s access is managed by IRA');
  if (p_status = 'inactive' or p_role = 'client_user') and cu.role = 'client_admin' and cu.status = 'active' then
    select count(*) into v_admins from public.client_users
    where client_id = cu.client_id and role = 'client_admin' and status = 'active' and id <> cu.id;
    perform private.require(v_admins > 0, 'Your organisation needs at least one active administrator');
  end if;
  update public.client_users set
    status = coalesce(case when p_status = 'active' and cu.status = 'inactive' then 'active' else p_status end, status),
    role = coalesce(p_role, role),
    updated_at = now()
  where id = cu.id;
end $$;
revoke execute on function public.client_user_update(uuid, text, text) from public, anon;
grant execute on function public.client_user_update(uuid, text, text) to authenticated;
set local lock_timeout = '5s';
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
  employee_id uuid primary key references public.employees(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  started_at timestamptz not null default now()
);
alter table public.task_timers enable row level security;
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
create or replace function private.today_ist()
returns date language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
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
    v_link := coalesce(v_link, nullif(btrim(coalesce(t.submitted_link, '')), ''));
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
  if p_to = 'awaiting_review' then
    select coalesce(max(draft_no), 0) + 1 into v_draft from public.task_drafts where task_id = t.id;
    insert into public.task_drafts(task_id, draft_no, link, note, submitted_by, on_time)
    values (t.id, v_draft, v_link, v_note, v_emp, private.today_ist() <= t.due_date);
  elsif p_to in ('completed','revision_required') and t.status = 'awaiting_review' then
    update public.task_drafts set decision = case when p_to = 'completed' then 'approved' else 'changes_requested' end,
      decided_by = auth.uid(), decided_at = now(), feedback = v_note
    where id = (select id from public.task_drafts where task_id = t.id and decision = 'pending' order by draft_no desc limit 1);
  end if;
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
  perform set_config('sigma.task_rpc', v_prev, true);
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

create or replace function public.task_people()
returns table (id uuid, profile_id uuid, name text, designation text, avatar_url text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.profile_id, e.name, d.name, e.avatar_url
  from public.employees e
  left join public.designations d on d.id = e.designation_id
  where private.current_client_id() is null
    and (private.is_admin()
      or e.id in (
        select t.assigned_by from public.tasks t where t.assigned_to = private.current_employee_id() and t.assigned_by is not null
        union select t.assigned_to from public.tasks t where t.assigned_by = private.current_employee_id()
        union select m.manager_id from public.employees m where m.id = private.current_employee_id() and m.manager_id is not null
        union select x.id from public.employees x where x.manager_id = private.current_employee_id()))
$$;
revoke execute on function public.task_people() from public, anon;
grant execute on function public.task_people() to authenticated;
create or replace function private.deliverables_events()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_url text := '/client/deliverables';
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'Awaiting Client Review' then
      if coalesce(current_setting('sigma.change_reason', true), '') not like 'Version % sent to client' then
        perform private.notify_client(new.client_id, 'deliverable', 'Deliverable ready for your review',
          new.deliverable_number || ' · ' || new.name || ' has been submitted for your review.', v_url,
          'deliv-review:' || new.id || ':' || new.version_no || ':' || extract(epoch from now())::bigint / 3600);
      end if;
    elsif new.status = 'Ready for Download' then
      perform private.notify_client(new.client_id, 'deliverable', 'Deliverable ready for download',
        new.deliverable_number || ' · ' || new.name || ' is complete and ready to download.', v_url,
        'deliv-ready:' || new.id || ':' || new.version_no);
    elsif new.status in ('Modification Requested','Under Internal Review') then
      perform private.notify_project_staff(new.project_id, 'deliverable', 'Deliverable ' || lower(new.status),
        new.deliverable_number || ' · ' || new.name || ' is now ' || new.status || '.',
        '/admin-clients?project=' || new.project_id || '&view=deliverables',
        'deliv-status:' || new.id || ':' || new.status || ':' || extract(epoch from now())::bigint / 60);
    end if;
  end if;
  if new.responsible_id is not null and (tg_op = 'INSERT' or new.responsible_id is distinct from old.responsible_id) then
    perform private.notify_employee(new.responsible_id, 'deliverable', 'Deliverable assigned to you',
      new.deliverable_number || ' · ' || new.name, '/emp-client-work',
      'deliv-assign:' || new.id || ':' || new.responsible_id);
  end if;
  return null;
end $$;
create temp table _all(m text);
do $test$
declare
  u_admin uuid := gen_random_uuid(); u_pm uuid := gen_random_uuid(); u_designer uuid := gen_random_uuid(); u_out uuid := gen_random_uuid();
  u_client uuid := gen_random_uuid(); u_other_client uuid := gen_random_uuid();
  e_pm uuid; e_designer uuid; e_out uuid; desig uuid; cl uuid; cl2 uuid; pr uuid; dl uuid; dl_draft uuid;
  c1 uuid; c2 uuid; sr uuid; n int; v text; ok boolean; results jsonb; failed int;
begin
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  grant select, insert on _r to authenticated;
  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'collab-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_pm, 'collab-pm@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_designer, 'collab-designer@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_out, 'collab-out@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_client, 'collab-client@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
    (u_other_client, 'collab-client2@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'employee' where id in (u_pm, u_designer, u_out);
  update public.profiles set role = 'client' where id in (u_client, u_other_client);
  select id into desig from public.designations limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_pm, 'ZZC01', 'zzc01', 'C Manager', desig, current_date) returning id into e_pm;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_designer, 'ZZC02', 'zzc02', 'C Designer', desig, current_date) returning id into e_designer;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_out, 'ZZC03', 'zzc03', 'C Outsider', desig, current_date) returning id into e_out;
  insert into public.clients(profile_id, company_name, primary_contact, email, status) values (u_client, 'Test Co', 'Tess', 'collab-client@example.invalid', 'active') returning id into cl;
  insert into public.clients(profile_id, company_name, primary_contact, email, status) values (u_other_client, 'Other Co', 'Otto', 'collab-client2@example.invalid', 'active') returning id into cl2;
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  insert into public.projects(name, client_id, status) values ('Test project', cl, 'active') returning id into pr;
  insert into public.project_managers(project_id, manager_id) values (pr, e_pm);
  insert into public.deliverables(project_id, client_id, deliverable_number, name, status, responsible_id) values (pr, cl, 'ZZ-001', 'Logo pack', 'In Progress', e_designer) returning id into dl;
  insert into public.deliverables(project_id, client_id, deliverable_number, name, status) values (pr, cl, 'ZZ-002', 'Secret draft', 'Draft') returning id into dl_draft;
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  c1 := public.deliverable_add_comment(dl, 'Can we try a darker blue?');
  select count(*) into n from public.notifications where recipient_id = u_pm and title like 'Client comment on%';
  insert into _r values ('project manager told about client comment', n = 1, n::text);
  select count(*) into n from public.notifications where recipient_id = u_designer and title like 'Client comment on%';
  insert into _r values ('responsible designer NOT told (no client contact)', n = 0, n::text);
  begin perform public.deliverable_add_comment(dl, 'secret', true); select visibility into v from public.deliverable_comments where body = 'secret'; ok := v = 'client';
  exception when others then ok := false; end;
  insert into _r values ('client cannot post internal notes', ok, coalesce(v, ''));
  begin perform public.deliverable_add_comment(dl_draft, 'peek'); ok := false; exception when others then ok := true; end;
  insert into _r values ('client cannot comment on drafts', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_designer, 'role', 'authenticated')::text, true);
  begin perform public.deliverable_add_comment(dl, 'hello client'); ok := false; exception when others then ok := true; end;
  insert into _r values ('designer cannot post to client thread', ok, '');
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.deliverable_comments where deliverable_id = dl;
  perform set_config('role', 'postgres', true);
  insert into _r values ('designer cannot read client thread', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  c2 := public.deliverable_add_comment(dl, 'Internal: check brand guide first', true);
  perform public.deliverable_add_comment(dl, 'Sure — new version tomorrow');
  select count(*) into n from public.notifications where recipient_id = u_client and title like 'New comment on%';
  insert into _r values ('client told about staff reply (not the internal note)', n = 1, n::text);
  select count(*) into n from public.deliverable_comments where deliverable_id = dl and author_kind = 'staff' and author_name <> 'IRA team';
  insert into _r values ('staff comments signed IRA team', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.deliverable_comments where deliverable_id = dl;
  select count(*) into failed from public.deliverable_comments where id = c2;
  perform set_config('role', 'postgres', true);
  insert into _r values ('client sees thread without internal notes', n = 3 and failed = 0, n || '/' || failed);
  perform set_config('request.jwt.claims', json_build_object('sub', u_other_client, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.deliverable_comments where deliverable_id = dl;
  perform set_config('role', 'postgres', true);
  insert into _r values ('another client sees nothing', n = 0, n::text);
  begin perform public.deliverable_add_comment(dl, 'hi'); ok := false; exception when others then ok := true; end;
  insert into _r values ('another client cannot comment', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.deliverable_comments where deliverable_id = dl;
  perform set_config('role', 'postgres', true);
  insert into _r values ('unrelated employee sees nothing', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.deliverable_comments where deliverable_id = dl;
  perform set_config('role', 'postgres', true);
  insert into _r values ('project manager sees internal notes too', n = 4, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  sr := public.support_create('Invoice question', 'Is GST included in milestone 2?', 'billing', pr);
  select request_number into v from public.support_requests where id = sr;
  insert into _r values ('request numbered', v like 'SR-%', v);
  select count(*) into n from public.notifications where recipient_id = u_admin and title like 'Support request SR-%';
  insert into _r values ('admin notified of new request', n = 1, n::text);
  select count(*) into n from public.notifications where recipient_id = u_pm and title like 'Support request SR-%';
  insert into _r values ('project manager notified of new request', n = 1, n::text);
  begin perform public.support_create('Other project', 'x', 'question', gen_random_uuid()); ok := false; exception when others then ok := true; end;
  insert into _r values ('cannot attach someone else''s project', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  perform public.support_reply(sr, 'Checking with finance', true);
  perform public.support_reply(sr, 'Yes, 18% GST is included.');
  select status into v from public.support_requests where id = sr;
  insert into _r values ('staff reply moves to in progress', v = 'in_progress', v);
  begin perform public.support_set_status(sr, 'in_progress', e_designer); ok := false; exception when others then ok := true; end;
  insert into _r values ('cannot assign support to a non-manager employee', ok, '');
  perform public.support_set_status(sr, 'resolved', e_pm);
  select count(*) into n from public.support_messages where request_id = sr and author_kind = 'staff' and author_name <> 'IRA team';
  insert into _r values ('support replies signed IRA team', n = 0, n::text);
  select count(*) into n from public.notifications where recipient_id = u_client and title like '% resolved';
  insert into _r values ('client told it is resolved', n = 1, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.support_messages where request_id = sr;
  perform set_config('role', 'postgres', true);
  insert into _r values ('client sees messages without internal note', n = 2, n::text);
  begin perform public.support_set_status(sr, 'in_progress'); ok := false; exception when others then ok := true; end;
  insert into _r values ('client cannot change workflow status', ok, '');
  perform public.support_reply(sr, 'Thanks, one more thing…');
  select status into v from public.support_requests where id = sr;
  insert into _r values ('client reply reopens resolved request', v = 'open', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_other_client, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.support_requests where id = sr;
  perform set_config('role', 'postgres', true);
  insert into _r values ('another client cannot see the request', n = 0, n::text);
  begin perform public.support_reply(sr, 'hijack'); ok := false; exception when others then ok := true; end;
  insert into _r values ('another client cannot reply', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_designer, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.support_requests where id = sr;
  perform set_config('role', 'postgres', true);
  insert into _r values ('designer cannot see the request', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.support_requests where id = sr;
  perform set_config('role', 'postgres', true);
  insert into _r values ('unrelated employee cannot see the request', n = 0, n::text);
  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 160)))
    into failed, results from _r;
  raise exception 'COLLAB_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
exception when others then
 perform set_config('role','postgres',true);
 insert into _all values (sqlerrm);
end
$test$;
do $test$
declare
  u_admin uuid := gen_random_uuid(); u_primary uuid := gen_random_uuid(); u_col uuid := gen_random_uuid(); u_viewer uuid := gen_random_uuid(); u_other uuid := gen_random_uuid();
  cl uuid; cl2 uuid; cu_col uuid; cu_viewer uuid; cu_primary uuid; ok boolean; v text; results jsonb; failed int;
begin
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'team-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_primary, 'team-primary@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
    (u_col, 'team-col@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
    (u_viewer, 'team-viewer@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
    (u_other, 'team-other@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'client' where id in (u_primary, u_col, u_viewer, u_other);
  insert into public.clients(profile_id, company_name, primary_contact, email, status) values (u_primary, 'Team Co', 'Pri', 'team-primary@example.invalid', 'active') returning id into cl;
  insert into public.clients(profile_id, company_name, primary_contact, email, status) values (u_other, 'Other Co', 'Oth', 'team-other@example.invalid', 'active') returning id into cl2;
  select id into cu_primary from public.client_users where profile_id = u_primary;
  insert into public.client_users(client_id, profile_id, role, status, full_name, email) values (cl, u_col, 'client_admin', 'active', 'Col', 'team-col@example.invalid') returning id into cu_col;
  insert into public.client_users(client_id, profile_id, role, status, full_name, email) values (cl, u_viewer, 'client_user', 'active', 'Viewer', 'team-viewer@example.invalid') returning id into cu_viewer;
  perform set_config('request.jwt.claims', json_build_object('sub', u_viewer, 'role', 'authenticated')::text, true);
  begin perform public.client_user_update(cu_col, 'inactive'); ok := false; exception when others then ok := true; end;
  insert into _r values ('client user cannot change access', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  begin perform public.client_user_update(cu_viewer, 'inactive'); ok := false; exception when others then ok := true; end;
  insert into _r values ('other organisation cannot change access', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_col, 'role', 'authenticated')::text, true);
  begin perform public.client_user_update(cu_primary, 'inactive'); ok := false; exception when others then ok := sqlerrm like '%managed by IRA%'; end;
  insert into _r values ('primary contact protected', ok, '');
  begin perform public.client_user_update(cu_col, null, 'client_user'); ok := false; exception when others then ok := sqlerrm like '%own access%'; end;
  insert into _r values ('cannot change own access', ok, '');
  perform public.client_user_update(cu_viewer, 'inactive');
  select status into v from public.client_users where id = cu_viewer;
  insert into _r values ('client admin deactivates colleague', v = 'inactive', v);
  perform public.client_user_update(cu_viewer, 'active', 'client_admin');
  select status || '/' || role into v from public.client_users where id = cu_viewer;
  insert into _r values ('client admin reactivates and promotes', v = 'active/client_admin', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_viewer, 'role', 'authenticated')::text, true);
  perform public.client_user_update(cu_col, 'inactive');
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  update public.client_users set role = 'client_user' where id = cu_primary;
  begin perform public.client_user_update(cu_viewer, 'inactive'); ok := false; exception when others then ok := sqlerrm like '%at least one active administrator%'; end;
  insert into _r values ('last active client admin kept', ok, '');
  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 160)))
    into failed, results from _r;
  raise exception 'TEAM_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
exception when others then
 perform set_config('role','postgres',true);
 insert into _all values (sqlerrm);
end
$test$;
do $test$
declare
  u_admin uuid := gen_random_uuid();
  u_emp uuid := gen_random_uuid();
  u_mgr uuid := gen_random_uuid();
  u_solo uuid := gen_random_uuid();
  u_out uuid := gen_random_uuid();
  e_emp uuid; e_mgr uuid; e_solo uuid; e_out uuid; desig uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l6 uuid; n int; v text; ok boolean; num numeric;
  results jsonb; failed int;
  base date; mon date;
begin
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  grant select, insert on _r to authenticated;
  base := (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date + 62))::date + 7;
  mon := base + ((8 - extract(isodow from base)::int) % 7);
  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'leave-test-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_emp, 'leave-test-emp@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_mgr, 'leave-test-mgr@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_solo, 'leave-test-solo@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_out, 'leave-test-out@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'employee' where id in (u_emp, u_mgr, u_solo, u_out);
  select id into desig from public.designations limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_mgr, 'ZZL02', 'zzl02', 'L Manager', desig, current_date) returning id into e_mgr;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, manager_id, join_date) values (u_emp, 'ZZL01', 'zzl01', 'L Employee', desig, e_mgr, current_date) returning id into e_emp;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_solo, 'ZZL03', 'zzl03', 'L Solo', desig, current_date) returning id into e_solo;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_out, 'ZZL04', 'zzl04', 'L Outsider', desig, current_date) returning id into e_out;
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, reason, status)
  values (e_emp, 'casual', mon + 14, mon + 14, 'full', 'default chain', 'pending') returning id into l6;
  select manager_status into v from public.leave_requests where id = l6;
  insert into _r values ('default chain keeps admin-only approval', v = 'skipped', v);
  select count(*) into n from public.notifications where recipient_id = u_admin and title = 'New leave request';
  insert into _r values ('admin notified under default chain', n = 1, n::text);
  perform set_config('request.jwt.claims', '', true);
  update public.approval_settings set leave_chain = 'manager_then_admin' where id;
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, reason, status)
  values (e_emp, 'casual', mon, mon, 'full', 'family', 'pending') returning id into l1;
  select manager_status into v from public.leave_requests where id = l1;
  insert into _r values ('new request waits for manager', v = 'pending', v);
  select count(*) into n from public.notifications where recipient_id = u_mgr and title = 'Leave request to review';
  insert into _r values ('manager notified', n = 1, n::text);
  begin
    insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, status, reason)
    values (e_emp, 'vacation', mon + 1, mon + 1, 'full', 'pending', 'test'); ok := false;
  exception when others then ok := sqlerrm like 'Choose a valid leave type%'; end;
  insert into _r values ('unknown leave type rejected', ok, '');
  perform set_config('role', 'authenticated', true);
  update public.leave_requests set status = 'approved' where id = l1;
  perform set_config('role', 'postgres', true);
  select status into v from public.leave_requests where id = l1;
  insert into _r values ('employee cannot self-approve', v = 'pending', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.leave_requests where id = l1;
  perform set_config('role', 'postgres', true);
  insert into _r values ('outsider cannot see request', n = 0, n::text);
  begin perform public.leave_manager_review(l1, 'approved'); ok := false; exception when others then ok := true; end;
  insert into _r values ('outsider cannot review', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.leave_requests where id = l1;
  perform set_config('role', 'postgres', true);
  insert into _r values ('manager can see report request (RLS)', n = 1, n::text);
  select count(*) into n from public.leave_team_requests() where id = l1 and employee_name = 'L Employee';
  insert into _r values ('team list includes request with name', n = 1, n::text);
  begin perform public.leave_manager_review(l1, 'rejected'); ok := false; exception when others then ok := sqlerrm like 'Give a reason%'; end;
  insert into _r values ('reject needs a reason', ok, '');
  v := public.leave_manager_review(l1, 'approved', 'Fine by me');
  select status || '/' || manager_status into v from public.leave_requests where id = l1;
  insert into _r values ('manager approval forwards to admin', v = 'pending/approved', v);
  select count(*) into n from public.notifications where recipient_id = u_admin and title = 'Leave approved by manager';
  insert into _r values ('admin told it is ready', n = 1, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform public.leave_admin_review(l1, 'approved');
  select status, paid_days + unpaid_days into v, num from public.leave_requests where id = l1;
  insert into _r values ('admin final approval books the day', v = 'approved' and num = 1, v || ' ' || num);
  select count(*) into n from public.notifications where recipient_id = u_emp and title = 'Leave request approved';
  insert into _r values ('employee notified of approval', n = 1, n::text);
  update public.leave_types set annual_limit = 2, document_required_after_days = 0 where code = 'sick';
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  begin
    insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, status, reason)
    values (e_emp, 'sick', mon + 7, mon + 9, 'full', 'pending', 'test'); ok := false;
  exception when others then ok := sqlerrm like '%allowed this year%'; end;
  insert into _r values ('annual limit enforced', ok, '');
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, status, reason)
  values (e_emp, 'sick', mon + 1, mon + 1, 'full', 'pending', 'test') returning id into l2;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  begin perform public.leave_manager_review(l2, 'approved'); ok := false; exception when others then ok := sqlerrm like '%supporting document%'; end;
  insert into _r values ('document required before approval', ok, '');
  perform set_config('role', 'postgres', true);
  insert into public.files(file_group_id, version_no, parent_type, parent_id, name, storage_path, visibility, uploaded_by)
  values (gen_random_uuid(), 1, 'leave', l2, 'note.pdf', u_emp::text || '/note.pdf', 'internal', u_emp);
  perform public.leave_manager_review(l2, 'approved');
  select manager_status into v from public.leave_requests where id = l2;
  insert into _r values ('approves once document attached', v = 'approved', v);
  ok := private.can_read_file((select id from public.files where parent_id = l2));
  insert into _r values ('manager can open the document', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  ok := not private.can_read_file((select id from public.files where parent_id = l2));
  insert into _r values ('outsider cannot open the document', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, status, reason)
  values (e_emp, 'casual', mon + 2, mon + 2, 'half', 'pending', 'test') returning id into l3;
  perform public.leave_cancel(l3);
  select status into v from public.leave_requests where id = l3;
  insert into _r values ('employee can withdraw pending request', v = 'cancelled', v);
  update public.approval_settings set leave_chain = 'manager' where id;
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, status, reason)
  values (e_emp, 'casual', mon + 3, mon + 3, 'full', 'pending', 'test') returning id into l4;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  v := public.leave_manager_review(l4, 'approved');
  select status into v from public.leave_requests where id = l4;
  insert into _r values ('manager-only chain approves directly', v = 'approved', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_solo, 'role', 'authenticated')::text, true);
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, status, reason)
  values (e_solo, 'casual', mon, mon, 'full', 'pending', 'test') returning id into l5;
  select manager_status into v from public.leave_requests where id = l5;
  insert into _r values ('no manager skips manager step', v = 'skipped', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.leave_requests set status = 'rejected', reviewed_at = now() where id = l5 and status = 'pending';
  perform set_config('role', 'postgres', true);
  select status into v from public.leave_requests where id = l5;
  insert into _r values ('existing admin screen can still decide', v = 'rejected', v);
  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 160)))
    into failed, results from _r;
  raise exception 'LEAVE_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
exception when others then
 perform set_config('role','postgres',true);
 insert into _all values (sqlerrm);
end
$test$;
do $test$
declare
  u_admin uuid := gen_random_uuid(); u_emp uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_out uuid := gen_random_uuid();
  e_emp uuid; e_mgr uuid; e_out uuid; desig uuid;
  cyc uuid; k1 uuid; k2 uuid; rv uuid; n int; v text; ok boolean; num numeric; m uuid;
  results jsonb; failed int;
begin
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  grant select, insert on _r to authenticated;
  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'perf-test-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_emp, 'perf-test-emp@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_mgr, 'perf-test-mgr@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_out, 'perf-test-out@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'employee' where id in (u_emp, u_mgr, u_out);
  select id into desig from public.designations limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_mgr, 'ZZP02', 'zzp02', 'P Manager', desig, current_date - 800) returning id into e_mgr;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, manager_id, join_date) values (u_emp, 'ZZP01', 'zzp01', 'P Employee', desig, e_mgr, current_date - 800) returning id into e_emp;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_out, 'ZZP03', 'zzp03', 'P Outsider', desig, current_date - 800) returning id into e_out;
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.performance_cycles(name, period_type, start_date, end_date) values ('Q3 test', 'quarterly', current_date - 90, current_date) returning id into cyc;
  insert into public.kras(cycle_id, employee_id, title, target, weightage) values (cyc, e_emp, 'Deliver brand kits', '12 kits', 60) returning id into k1;
  insert into public.kras(cycle_id, employee_id, title, target, weightage) values (cyc, e_emp, 'Client satisfaction', '4.5 / 5', 30) returning id into k2;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.kras where cycle_id = cyc;
  perform set_config('role', 'postgres', true);
  insert into _r values ('draft KRAs hidden from employee', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  begin perform public.performance_open_cycle(cyc); ok := false; exception when others then ok := sqlerrm like 'Weightage must add up to 100%'; end;
  insert into _r values ('weightage must total 100', ok, '');
  update public.kras set weightage = 40 where id = k2;
  n := public.performance_open_cycle(cyc);
  insert into _r values ('cycle opens and creates reviews', n = 1, n::text);
  select id into rv from public.performance_reviews where cycle_id = cyc and employee_id = e_emp;
  select count(*) into n from public.notifications where recipient_id = u_emp and title = 'Performance review open';
  insert into _r values ('employee told the review is open', n = 1, n::text);
  begin
    insert into public.kras(cycle_id, employee_id, title, weightage) values (cyc, e_emp, 'Late add', 10); ok := false;
  exception when others then ok := sqlerrm like 'KRAs can only be added%'; end;
  insert into _r values ('no KRAs added after opening', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.kras where cycle_id = cyc;
  update public.kras set self_score = 100, manager_score = 100 where id = k1;
  perform set_config('role', 'postgres', true);
  insert into _r values ('employee sees own KRAs once open', n = 2, n::text);
  select coalesce(self_score, -1) into num from public.kras where id = k1;
  insert into _r values ('employee cannot write scores directly', num = -1, num::text);
  begin perform public.performance_submit_self(rv); ok := false; exception when others then ok := sqlerrm like 'Score every KRA%'; end;
  insert into _r values ('cannot submit before scoring all', ok, '');
  perform public.performance_self_assess(k1, '11 kits', 85, 'One kit slipped');
  perform public.performance_self_assess(k2, '4.6', 95);
  begin perform public.performance_manager_assess(k1, 100); ok := false; exception when others then ok := true; end;
  insert into _r values ('employee cannot manager-score self', ok, '');
  perform public.performance_submit_self(rv, 'Good quarter');
  select count(*) into n from public.notifications where recipient_id = u_mgr and title = 'Self-review submitted';
  insert into _r values ('manager notified of self-review', n = 1, n::text);
  begin perform public.performance_self_assess(k1, 'x', 50); ok := false; exception when others then ok := sqlerrm like '%already submitted%'; end;
  insert into _r values ('self-assessment locked after submit', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  begin perform public.performance_manager_assess(k1, 10); ok := false; exception when others then ok := true; end;
  insert into _r values ('outsider cannot score', ok, '');
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.performance_reviews where id = rv;
  perform set_config('role', 'postgres', true);
  insert into _r values ('outsider cannot read review', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.kras where cycle_id = cyc;
  perform set_config('role', 'postgres', true);
  insert into _r values ('manager sees report KRAs', n = 2, n::text);
  perform public.performance_manager_assess(k1, 90, 'Strong');
  begin perform public.performance_submit_manager(rv, 'Solid'); ok := false; exception when others then ok := sqlerrm like 'Score every KRA%'; end;
  insert into _r values ('manager must score all', ok, '');
  perform public.performance_manager_assess(k2, 80);
  perform public.performance_submit_manager(rv, 'Solid quarter', 'Craft', 'Speed');
  select overall_score into num from public.performance_reviews where id = rv;
  insert into _r values ('manager weighted score = 86', num = 86, num::text);
  begin perform public.performance_finalize(rv); ok := false; exception when others then ok := true; end;
  insert into _r values ('manager cannot finalize', ok, '');
  begin perform public.employee_add_milestone(e_emp, 'promotion', 'Senior designer', current_date); ok := false; exception when others then ok := true; end;
  insert into _r values ('manager cannot record promotion', ok, '');
  m := public.employee_add_milestone(e_emp, 'recognition', 'Client shout-out', current_date, 'Praised by Acme');
  insert into _r values ('manager records recognition', m is not null, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  num := public.performance_finalize(rv, jsonb_build_object(k2::text, 85));
  select rating into v from public.performance_reviews where id = rv;
  insert into _r values ('final weighted score = 88 with override', num = 88, num::text);
  insert into _r values ('rating assigned', v = 'Exceeds expectations', v);
  select count(*) into n from public.notifications where recipient_id = u_emp and title = 'Performance review finalized';
  insert into _r values ('employee told of final score', n = 1, n::text);
  begin update public.kras set title = 'changed' where id = k1; ok := false; exception when others then ok := sqlerrm like '%closed%'; end;
  insert into _r values ('finalized KRAs locked', ok, '');
  perform public.performance_close_cycle(cyc);
  select status into v from public.performance_cycles where id = cyc;
  insert into _r values ('cycle closed', v = 'closed', v);
  perform public.employee_add_milestone(e_emp, 'warning', 'Late delivery', current_date, null, null, null, false);
  perform public.employee_add_milestone(e_emp, 'promotion', 'Senior designer', current_date - 400, null, 'Designer', 'Senior designer');
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.employee_milestones where employee_id = e_emp;
  select count(*) into failed from public.employee_milestones where employee_id = e_emp and kind = 'warning';
  perform set_config('role', 'postgres', true);
  insert into _r values ('employee sees visible milestones only', n = 2 and failed = 0, n || '/' || failed);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  update public.performance_settings set promotion_min_reviews = 1, promotion_min_score = 80, promotion_min_months = 6 where id;
  select count(*) into n from public.performance_promotion_candidates() where employee_id = e_emp;
  insert into _r values ('eligible employee listed for promotion', n = 1, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  select count(*) into n from public.performance_promotion_candidates();
  insert into _r values ('employees cannot list candidates', n = 0, n::text);
  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 160)))
    into failed, results from _r;
  raise exception 'PERF_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
exception when others then
 perform set_config('role','postgres',true);
 insert into _all values (sqlerrm);
end
$test$;
do $test$
declare
  u_admin uuid := gen_random_uuid(); u_pm uuid := gen_random_uuid(); u_emp uuid := gen_random_uuid(); u_out uuid := gen_random_uuid();
  u_client uuid := gen_random_uuid(); u_other uuid := gen_random_uuid();
  e_pm uuid; e_emp uuid; e_out uuid; desig uuid; cl uuid; cl2 uuid; pr uuid; dl uuid; t1 uuid; rv1 uuid; rv2 uuid;
  n int; v text; ok boolean; j jsonb; results jsonb; failed int; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  grant select, insert on _r to authenticated;
  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'rv-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_pm, 'rv-pm@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_emp, 'rv-emp@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_out, 'rv-out@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_client, 'rv-client@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
    (u_other, 'rv-client2@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'employee' where id in (u_pm, u_emp, u_out);
  update public.profiles set role = 'client' where id in (u_client, u_other);
  select id into desig from public.designations order by can_assign_tasks desc limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id) values (u_pm, 'ZZR01', 'zzr01', 'R Manager', desig) returning id into e_pm;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, manager_id) values (u_emp, 'ZZR02', 'zzr02', 'R Designer', desig, e_pm) returning id into e_emp;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id) values (u_out, 'ZZR03', 'zzr03', 'R Outsider', desig) returning id into e_out;
  insert into public.clients(profile_id, company_name, primary_contact, email, status) values (u_client, 'Review Co', 'Rae', 'rv-client@example.invalid', 'active') returning id into cl;
  insert into public.clients(profile_id, company_name, primary_contact, email, status) values (u_other, 'Other Co', 'Otto', 'rv-client2@example.invalid', 'active') returning id into cl2;
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  insert into public.projects(name, client_id, status) values ('Review project', cl, 'active') returning id into pr;
  insert into public.project_managers(project_id, manager_id) values (pr, e_pm);
  insert into public.deliverables(project_id, client_id, deliverable_number, name, status, responsible_id) values (pr, cl, 'ZZR-001', 'Social posts', 'In Progress', e_emp) returning id into dl;
  insert into public.tasks(title, assigned_to, assigned_by, start_date, due_date, priority, project_id, deliverable_id, estimate_minutes)
  values ('Design 5 posts', e_emp, e_pm, v_today, v_today + 3, 'high', pr, dl, 240) returning id into t1;
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.task_timer_start(t1);
  select status into v from public.tasks where id = t1;
  insert into _r values ('timer start moves task in progress', v = 'in_progress', v);
  select count(*) into n from public.task_timers where task_id = t1;
  insert into _r values ('timer running', n = 1, n::text);
  begin perform public.task_transition(t1, 'awaiting_review', 'v1'); ok := false; exception when others then ok := sqlerrm like '%link%'; end;
  insert into _r values ('draft needs a link', ok, '');
  perform public.task_transition(t1, 'awaiting_review', 'First pass', 'https://drive.example.com/v1');
  select count(*) into n from public.task_timers where task_id = t1;
  select count(*) into failed from public.task_time_logs where task_id = t1 and note = 'Timer';
  insert into _r values ('hand-in stops timer and logs time', n = 0 and failed = 1, n || '/' || failed);
  select draft_no || ':' || decision || ':' || on_time into v from public.task_drafts where task_id = t1;
  insert into _r values ('draft 1 recorded', v = '1:pending:true', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.task_drafts where task_id = t1;
  perform set_config('role', 'postgres', true);
  insert into _r values ('outsider cannot see drafts', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'revision_required', 'Use brand colours');
  select decision || ':' || feedback into v from public.task_drafts where task_id = t1 and draft_no = 1;
  insert into _r values ('draft 1 changes requested with feedback', v = 'changes_requested:Use brand colours', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'in_progress');
  perform public.task_transition(t1, 'awaiting_review', null, 'https://drive.example.com/v2');
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'completed', 'Looks great');
  select string_agg(draft_no || ':' || decision, ',' order by draft_no) into v from public.task_drafts where task_id = t1;
  insert into _r values ('draft history', v = '1:changes_requested,2:approved', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  begin perform public.staff_send_to_client(dl, null, null, t1); ok := false; exception when others then ok := true; end;
  insert into _r values ('employee cannot send to client', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  rv1 := public.staff_send_to_client(dl, null, 'Five posts for review', t1);
  select status into v from public.deliverables where id = dl;
  insert into _r values ('deliverable awaiting client review', v = 'Awaiting Client Review', v);
  select link into v from public.deliverable_client_reviews where id = rv1;
  insert into _r values ('round uses approved draft link', v = 'https://drive.example.com/v2', v);
  select count(*) into n from public.notifications where recipient_id = u_client and title = 'New version to review';
  insert into _r values ('client notified', n = 1, n::text);
  begin perform public.staff_send_to_client(dl, 'https://x.example.com', null, null); ok := false; exception when others then ok := true; end;
  insert into _r values ('cannot send while a round is pending', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  select count(*) into n from public.client_deliverable_reviews(dl);
  insert into _r values ('client sees version list', n = 1, n::text);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.task_drafts where task_id = t1;
  select count(*) into failed from public.deliverable_client_reviews;
  perform set_config('role', 'postgres', true);
  insert into _r values ('client cannot read drafts or raw review rows', n = 0 and failed = 0, n || '/' || failed);
  begin perform public.client_decide_review(rv1, false, 'no'); ok := false; exception when others then ok := true; end;
  insert into _r values ('change request needs a description', ok, '');
  perform public.client_decide_review(rv1, false, 'Make the logo bigger on post 3');
  select status into v from public.deliverables where id = dl;
  insert into _r values ('deliverable back to revision', v = 'Revision In Progress', v);
  select count(*) into n from public.notifications where recipient_id = u_pm and title like 'Client requested changes%';
  insert into _r values ('manager told about client changes', n = 1, n::text);
  select count(*) into n from public.notifications where recipient_id = u_emp and title like 'Client%';
  insert into _r values ('employee NOT told directly', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  select count(*) into n from public.client_deliverable_reviews(dl);
  insert into _r values ('other client sees nothing', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  begin perform public.staff_forward_client_feedback(rv1, 'x'); ok := false; exception when others then ok := true; end;
  insert into _r values ('employee cannot forward', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  perform public.staff_forward_client_feedback(rv1, 'Bump to 1.5x please');
  select status into v from public.tasks where id = t1;
  insert into _r values ('task reopened for revision', v = 'revision_required', v);
  select count(*) into n from public.task_comments where task_id = t1 and body like 'Client feedback on version 1%';
  insert into _r values ('feedback posted on task', n = 1, n::text);
  select count(*) into n from public.notifications where recipient_id = u_emp and type = 'task';
  insert into _r values ('employee notified via task', n >= 1, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'in_progress');
  perform public.task_transition(t1, 'awaiting_review', null, 'https://drive.example.com/v3');
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'completed');
  rv2 := public.staff_send_to_client(dl, null, null, t1);
  select round_no into n from public.deliverable_client_reviews where id = rv2;
  insert into _r values ('admin sends version 2', n = 2, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  perform public.client_decide_review(rv2, true, 'Perfect');
  select status into v from public.deliverables where id = dl;
  insert into _r values ('client approval completes deliverable', v = 'Completed', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  j := public.employee_review_metrics();
  insert into _r values ('metrics drafts', (j->>'drafts')::int = 3 and (j->>'approval_rate')::numeric = 66.7 and (j->>'first_draft_approval_rate')::numeric = 0, j::text);
  insert into _r values ('metrics client', (j->>'client_rounds')::int = 2 and (j->>'client_first_time_rate')::numeric = 0, j::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  begin perform public.employee_review_metrics(e_emp); ok := false; exception when others then ok := true; end;
  insert into _r values ('outsider cannot read metrics', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  select count(*) into n from public.team_review_metrics() where employee_id = e_emp;
  insert into _r values ('manager team metrics include report', n = 1, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  insert into public.deliverables(project_id, client_id, deliverable_number, name, status) values (pr, cl, 'ZZR-002', 'Banner', 'Awaiting Client Review') returning id into dl;
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  perform public.client_review_deliverable(dl, false, 'Wrong size please fix');
  select d.status || '/' || r.status into v from public.deliverables d join public.deliverable_client_reviews r on r.deliverable_id = d.id where d.id = dl;
  insert into _r values ('legacy review records a round', v = 'Revision In Progress/changes_requested', coalesce(v, 'null'));
  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 200)))
    into failed, results from _r;
  raise exception 'REVIEW_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
exception when others then
 perform set_config('role','postgres',true);
 insert into _all values (sqlerrm);
end
$test$;
do $test$
declare
  results jsonb := '[]'::jsonb;
  failed int := 0;
  u_admin uuid := gen_random_uuid();
  u_c1 uuid := gen_random_uuid();
  u_c1b uuid := gen_random_uuid();
  u_c2 uuid := gen_random_uuid();
  u_emp uuid := gen_random_uuid();
  u_mgr uuid := gen_random_uuid();
  e_emp uuid; e_mgr uuid; desig uuid;
  cl_a uuid; cl_b uuid; pr_a uuid; pr_b uuid;
  d_a uuid; d_b uuid; k_a uuid; cr uuid; inst uuid; pay uuid; f_final uuid; dep uuid;
  n int; v text; ok boolean; j jsonb;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  grant select, insert on _r to authenticated;
  insert into auth.users(id, email, raw_app_meta_data, aud, role)
  values (u_admin, 'sigma-test-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
         (u_c1, 'sigma-test-c1@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
         (u_c1b, 'sigma-test-c1b@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
         (u_c2, 'sigma-test-c2@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
         (u_emp, 'sigma-test-emp@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
         (u_mgr, 'sigma-test-mgr@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'client' where id in (u_c1, u_c1b, u_c2);
  update public.profiles set role = 'employee' where id in (u_emp, u_mgr);
  select id into desig from public.designations order by can_assign_tasks desc limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id)
  values (u_emp, 'ZZTEST01', 'zztest01', 'Test Designer', desig) returning id into e_emp;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id)
  values (u_mgr, 'ZZTEST02', 'zztest02', 'Test Manager', desig) returning id into e_mgr;
  insert into public.clients(profile_id, company_name, primary_contact, email, status)
  values (u_c1, 'Test Client A', 'Alice', 'sigma-test-c1@example.invalid', 'active') returning id into cl_a;
  insert into public.clients(profile_id, company_name, primary_contact, email, status)
  values (u_c2, 'Test Client B', 'Bob', 'sigma-test-c2@example.invalid', 'active') returning id into cl_b;
  insert into public.client_users(client_id, profile_id, role, status, full_name)
  values (cl_a, u_c1b, 'client_user', 'active', 'Alan');
  insert into public.projects(name, status, client_id) values ('Test Project A', 'active', cl_a) returning id into pr_a;
  insert into public.projects(name, status, client_id) values ('Test Project B', 'active', cl_b) returning id into pr_b;
  insert into public.project_managers(project_id, manager_id) values (pr_a, e_mgr);
  insert into public.deliverables(project_id, name, quantity, due_date, responsible_id, status)
  values (pr_a, 'Social posts', 10, v_today + 30, e_emp, 'Draft') returning id into d_a;
  insert into public.deliverables(project_id, name, quantity, status)
  values (pr_b, 'Brand book', 1, 'Pending') returning id into d_b;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.projects where id in (pr_a, pr_b);
  insert into _r values ('client A sees only own project', n = 1, n::text);
  select count(*) into n from public.deliverables where id = d_b;
  insert into _r values ('client A cannot read client B deliverable by id', n = 0, n::text);
  select count(*) into n from public.deliverables where id = d_a;
  insert into _r values ('client A cannot see Draft deliverable', n = 0, n::text);
  select count(*) into n from public.clients where id = cl_b;
  insert into _r values ('client A cannot read client B organisation', n = 0, n::text);
  begin
    insert into public.contract_acceptances(contract_id, project_id, version, url, who, event)
    values (gen_random_uuid(), pr_a, 'v1', 'x', 'forged', 'Accepted');
    insert into _r values ('client cannot forge acceptance', false, 'insert succeeded');
  exception when others then
    insert into _r values ('client cannot forge acceptance', true, sqlerrm);
  end;
  begin
    perform public.staff_create_contract(pr_a, 'Hack', null, 'https://x.example');
    insert into _r values ('client cannot create contract', false, 'created');
  exception when others then insert into _r values ('client cannot create contract', true, sqlerrm);
  end;
  select count(*) into n from public.audit_logs;
  insert into _r values ('client cannot read audit log', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  k_a := public.staff_create_contract(pr_a, 'Master Services Agreement', 'MSA-T1', 'https://docs.example/msa-v1.pdf',
                                      null, 600000, '+ GST', v_today, v_today + 365);
  select status into v from public.contracts where id = k_a;
  insert into _r values ('admin creates draft contract', v = 'Draft', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.contracts where id = k_a;
  insert into _r values ('client cannot see draft contract', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform public.staff_revise_contract(k_a, 'Updated payment terms', null, 'https://docs.example/msa-v2.pdf');
  perform public.staff_send_contract(k_a);
  select status || '/v' || current_version_no into v from public.contracts where id = k_a;
  insert into _r values ('revised contract sent as v2', v = 'Sent/v2', v);
  select count(*) into n from public.contract_versions where contract_id = k_a;
  insert into _r values ('both contract versions retained', n = 2, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_c2, 'role', 'authenticated')::text, true);
  begin
    perform public.client_accept_contract(k_a, 2, true);
    insert into _r values ('other client cannot accept contract', false, 'accepted');
  exception when others then insert into _r values ('other client cannot accept contract', true, sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1b, 'role', 'authenticated')::text, true);
  begin
    perform public.client_accept_contract(k_a, 2, true);
    insert into _r values ('restricted client user cannot accept', false, 'accepted');
  exception when others then insert into _r values ('restricted client user cannot accept', true, sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  perform public.client_mark_contract_viewed(k_a);
  begin
    perform public.client_accept_contract(k_a, 1, true);
    insert into _r values ('stale version acceptance rejected', false, 'accepted');
  exception when others then insert into _r values ('stale version acceptance rejected', true, sqlerrm);
  end;
  begin
    perform public.client_accept_contract(k_a, 2, false);
    insert into _r values ('acknowledgement required', false, 'accepted');
  exception when others then insert into _r values ('acknowledgement required', true, sqlerrm);
  end;
  j := public.client_accept_contract(k_a, 2, true, 'test-agent');
  select status into v from public.contracts where id = k_a;
  insert into _r values ('client accepts current version', v = 'Accepted', v || ' ' || j::text);
  select count(*) into n from public.contract_acceptances
  where contract_id = k_a and event = 'Accepted' and user_id = u_c1 and version_no = 2 and acknowledgement is not null;
  insert into _r values ('acceptance evidence captured', n = 1, n::text);
  select status into v from public.deliverables where id = d_a;
  insert into _r values ('acceptance activates draft deliverables', v = 'Pending', v);
  begin
    perform public.client_accept_contract(k_a, 2, true);
    insert into _r values ('double acceptance blocked', false, 'accepted twice');
  exception when others then insert into _r values ('double acceptance blocked', true, sqlerrm);
  end;
  perform set_config('role', 'postgres', true);
  begin
    update public.contract_acceptances set who = 'tampered' where contract_id = k_a;
    insert into _r values ('acceptance records immutable (even owner)', false, 'updated');
  exception when others then insert into _r values ('acceptance records immutable (even owner)', true, sqlerrm);
  end;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  cr := public.client_request_modification(d_a, 'quantity', 'Campaign extended', 15, null, null, 'idem-1');
  select requested_quantity::text || '/' || quantity_delta::text into v from public.change_requests where id = cr;
  insert into _r values ('quantity request records original/requested/delta', v = '15.00/5.00', v);
  insert into _r values ('idempotent modification submit', public.client_request_modification(d_a, 'quantity', 'Campaign extended', 15, null, null, 'idem-1') = cr, '');
  begin
    perform public.client_request_modification(d_a, 'quantity', 'Again please', 20);
    insert into _r values ('one open request per type', false, 'second created');
  exception when others then insert into _r values ('one open request per type', true, sqlerrm);
  end;
  select count(*) into n from public.change_requests where id = cr;
  perform set_config('request.jwt.claims', json_build_object('sub', u_c2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.change_requests where id = cr;
  insert into _r values ('other client cannot see modification', n = 0, n::text);
  begin
    perform public.client_request_modification(d_a, 'quantity', 'Not my deliverable', 99);
    insert into _r values ('other client cannot request modification', false, 'created');
  exception when others then insert into _r values ('other client cannot request modification', true, sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  begin
    perform public.staff_review_modification(cr, 'approve', 'ok');
    insert into _r values ('employee cannot approve modification', false, 'approved');
  exception when others then insert into _r values ('employee cannot approve modification', true, sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  perform public.staff_review_modification(cr, 'approve', 'Approved with billing impact', null, null, null, '+5 posts billed next cycle');
  select quantity::text || '/v' || version_no into v from public.deliverables where id = d_a;
  insert into _r values ('approved modification updates scope with new version', v = '15.00/v2', v);
  select string_agg((snapshot ->> 'quantity'), ',' order by version_no) into v from public.deliverable_versions where deliverable_id = d_a;
  insert into _r values ('original scope preserved in history', v = '10.00,15.00', v);
  begin
    perform public.staff_set_deliverable_status(d_a, 'Completed');
    insert into _r values ('invalid transition rejected', false, 'Pending→Completed allowed');
  exception when others then insert into _r values ('invalid transition rejected', true, sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.staff_set_deliverable_status(d_a, 'In Progress');
  begin
    perform public.staff_set_deliverable_status(d_a, 'Awaiting Client Review');
    insert into _r values ('employee limited to own transitions', false, 'allowed');
  exception when others then insert into _r values ('employee limited to own transitions', true, sqlerrm);
  end;
  select count(*) into n from public.deliverables where id = d_b;
  insert into _r values ('employee cannot see unassigned client deliverable', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  dep := public.staff_request_dependency(d_a, 'Logo files', 'Vector logo please', v_today + 3);
  select status into v from public.deliverables where id = d_a;
  insert into _r values ('dependency request blocks deliverable', v = 'Awaiting Client Dependency', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1b, 'role', 'authenticated')::text, true);
  perform public.client_submit_dependency(dep, 'Shared via the brand drive link https://drive.example/logo');
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.staff_review_dependency(dep, 'accept', null);
  select status into v from public.deliverables where id = d_a;
  insert into _r values ('accepted dependency unblocks deliverable', v = 'In Progress', v);
  select count(*) into n from public.notifications where recipient_id = u_emp and type = 'dependency';
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  select count(*) into n from public.notifications where type = 'dependency';
  insert into _r values ('employee notified of uploaded dependency', n >= 1, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  insert into public.payment_installments(project_id, contract_id, name, basis_type, percentage, due_date, status)
  values (pr_a, k_a, 'Advance', 'percentage', 30, v_today - 2, 'Upcoming') returning id into inst;
  select amount::text || '/' || status into v from public.payment_installments where id = inst;
  insert into _r values ('percentage milestone computed and overdue', v = '180000.00/Overdue', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  begin
    update public.payment_installments set status = 'Paid', amount_paid = 180000 where id = inst;
    get diagnostics n = row_count;
    insert into _r values ('client cannot mark milestone paid', n = 0, n::text || ' rows');
  exception when others then insert into _r values ('client cannot mark milestone paid', true, sqlerrm);
  end;
  pay := public.client_submit_payment(inst, 100000, 'UTR123456', v_today - 1, 'bank_transfer', null, 'pay-idem-1');
  select status || '/' || amount_paid::text into v from public.payment_installments where id = inst;
  insert into _r values ('submitted reference is not counted as paid', v = 'Overdue/0.00', v);
  begin
    perform public.finance_verify_payment(pay, true);
    insert into _r values ('client cannot verify own payment', false, 'verified');
  exception when others then insert into _r values ('client cannot verify own payment', true, sqlerrm);
  end;
  begin
    perform public.client_submit_payment(inst, 90000, 'UTR999', v_today);
    insert into _r values ('cannot over-submit beyond outstanding', false, 'accepted');
  exception when others then insert into _r values ('cannot over-submit beyond outstanding', true, sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  update public.billing_settings set auto_lock_enabled = true, grace_days = 0 where id;
  perform set_config('role', 'postgres', true);
  perform private.evaluate_project_locks(pr_a);
  perform set_config('role', 'authenticated', true);
  select lock_state into v from public.deliverables where id = d_a;
  insert into _r values ('overdue payment locks deliverables', v = 'locked_payment', v);
  select count(*) into n from public.deliverable_lock_events where deliverable_id = d_a and new_state = 'locked_payment';
  insert into _r values ('lock event recorded', n = 1, n::text);
  begin
    update public.deliverables set lock_state = 'unlocked' where id = d_a;
    get diagnostics n = row_count;
    insert into _r values ('lock cannot be bypassed by direct update', n = 0, n::text || ' rows');
  exception when others then insert into _r values ('lock cannot be bypassed by direct update', true, sqlerrm);
  end;
  perform set_config('role', 'postgres', true);
  begin
    update public.deliverables set lock_state = 'unlocked' where id = d_a;
    insert into _r values ('lock guard holds even for table owner', false, 'updated');
  exception when others then insert into _r values ('lock guard holds even for table owner', true, sqlerrm);
  end;
  perform set_config('role', 'authenticated', true);
  begin
    update public.deliverables set quantity = 999 where id = d_a;
    get diagnostics n = row_count;
    insert into _r values ('scope cannot be edited without the reasoned RPC', n = 0, n::text || ' rows');
  exception when others then insert into _r values ('scope cannot be edited without the reasoned RPC', true, sqlerrm);
  end;
  perform public.finance_verify_payment(pay, true, 'Matched bank statement');
  select status || '/' || amount_paid::text into v from public.payment_installments where id = inst;
  insert into _r values ('verified partial payment updates balance', v = 'Overdue/100000.00', v);
  perform public.finance_record_payment(inst, 80000, 'UTR777888', v_today, 'bank_transfer', 'Balance received');
  select status into v from public.payment_installments where id = inst;
  insert into _r values ('fully paid milestone', v = 'Paid', v);
  select lock_state into v from public.deliverables where id = d_a;
  insert into _r values ('payment clears lock automatically', v = 'unlocked', v);
  perform set_config('role', 'postgres', true);
  insert into storage.objects(bucket_id, name, owner_id) values ('sigma-files', u_mgr::text || '/final.pdf', u_mgr::text);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  f_final := public.attach_file(u_mgr::text || '/final.pdf', 'deliverable', d_a, 'final.pdf', 'application/pdf', 1024, 'client', true);
  perform public.staff_set_deliverable_status(d_a, 'Under Internal Review');
  perform public.staff_set_deliverable_status(d_a, 'Awaiting Client Review');
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  insert into _r values ('final file hidden before ready', not private.can_read_file(f_final), '');
  perform public.client_review_deliverable(d_a, true, 'Looks great');
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  perform public.staff_set_deliverable_status(d_a, 'Ready for Download');
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  insert into _r values ('client can download ready final file', private.can_read_file(f_final), '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_c2, 'role', 'authenticated')::text, true);
  insert into _r values ('other client cannot read file', not private.can_read_file(f_final), '');
  select count(*) into n from storage.objects where name = u_mgr::text || '/final.pdf';
  insert into _r values ('other client cannot read storage object', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform public.staff_set_deliverable_lock(d_a, 'lock', 'Manual hold for dispute');
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  insert into _r values ('manual lock blocks download but deliverable stays visible',
    not private.can_read_file(f_final) and exists (select 1 from public.deliverables where id = d_a), '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  select count(*) into n from public.audit_logs where entity_type = 'deliverables' and entity_id = d_a::text;
  insert into _r values ('deliverable changes audited', n >= 5, n::text);
  select count(*) into n from public.audit_logs where entity_type = 'payments' and client_id = cl_a;
  insert into _r values ('payment events audited with client ownership', n >= 2, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.notifications where type = 'contract' and title = 'New contract to review';
  insert into _r values ('client notified once for sent contract', n = 1, n::text);
  perform set_config('role', 'postgres', true);
  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 160)))
    into failed, results from _r;
  raise exception 'SIGMA_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
exception when others then
 perform set_config('role','postgres',true);
 insert into _all values (sqlerrm);
end
$test$;
do $test$
declare
  u_admin uuid := gen_random_uuid();
  u_emp uuid := gen_random_uuid();
  u_mgr uuid := gen_random_uuid();
  u_out uuid := gen_random_uuid();
  e_emp uuid; e_mgr uuid; e_out uuid; desig uuid;
  t1 uuid; t2 uuid; st uuid; c uuid; n int; v text; ok boolean;
  results jsonb; failed int;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  grant select, insert on _r to authenticated;
  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'task-test-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_emp, 'task-test-emp@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_mgr, 'task-test-mgr@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_out, 'task-test-out@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'employee' where id in (u_emp, u_mgr, u_out);
  select id into desig from public.designations order by can_assign_tasks desc limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id) values (u_mgr, 'ZZT02', 'zzt02', 'T Manager', desig) returning id into e_mgr;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, manager_id) values (u_emp, 'ZZT01', 'zzt01', 'T Designer', desig, e_mgr) returning id into e_emp;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id) values (u_out, 'ZZT03', 'zzt03', 'T Outsider', desig) returning id into e_out;
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  insert into public.tasks(title, assigned_to, assigned_by, start_date, due_date, priority)
  values ('Logo concepts', e_emp, e_mgr, v_today, v_today + 5, 'high') returning id into t1;
  insert into public.tasks(title, assigned_to, assigned_by, start_date, due_date, priority)
  values ('Brand brief', e_emp, e_mgr, v_today, v_today + 2, 'medium') returning id into t2;
  select count(*) into n from public.notifications where recipient_id = u_emp and title = 'New task assigned';
  insert into _r values ('assignee notified of new tasks', n = 2, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  perform public.task_set_dependency(t1, t2, true);
  begin perform public.task_set_dependency(t2, t1, true); ok := false;
  exception when others then ok := sqlerrm like '%wait on each other%'; end;
  insert into _r values ('dependency cycle rejected', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'accepted');
  begin perform public.task_transition(t1, 'in_progress'); ok := false;
  exception when others then ok := sqlerrm like 'Waiting on:%'; end;
  insert into _r values ('cannot start while dependency open', ok, '');
  begin perform public.task_transition(t1, 'completed'); ok := false;
  exception when others then ok := true; end;
  insert into _r values ('assignee cannot self-approve assigner task before hand-in', ok, '');
  begin perform public.task_set_progress(t2, 40); ok := false;
  exception when others then ok := sqlerrm like 'Start the task%'; end;
  insert into _r values ('progress requires started task', ok, '');
  perform public.task_transition(t2, 'in_progress');
  perform public.task_set_progress(t2, 40);
  perform public.task_log_time(t2, 90, v_today, 'research');
  perform public.task_log_time(t2, 30, v_today, null);
  select time_spent_minutes, progress_pct::text into n, v from public.tasks where id = t2;
  insert into _r values ('time and progress recorded', n = 120 and v = '40', n || ' / ' || v);
  begin perform public.task_log_time(t2, 30, v_today + 1, null); ok := false;
  exception when others then ok := true; end;
  insert into _r values ('future time log rejected', ok, '');
  st := public.task_create_subtask(t2, 'Competitor list', v_today + 1);
  begin perform public.task_transition(t2, 'awaiting_review', null, 'https://example.com/brief'); ok := false;
  exception when others then ok := sqlerrm like '%subtasks%'; end;
  insert into _r values ('open subtask blocks hand-in', ok, '');
  begin perform public.task_create_subtask(t2, 'Late sub', v_today + 9); ok := false;
  exception when others then ok := sqlerrm like '%on or before%'; end;
  insert into _r values ('subtask cannot be due after parent', ok, '');
  perform public.task_transition(st, 'in_progress');
  perform public.task_transition(st, 'completed');
  select status into v from public.tasks where id = st;
  insert into _r values ('self-assigned subtask closed by assignee', v = 'completed', v);
  begin perform public.task_transition(t2, 'awaiting_review'); ok := false;
  exception when others then ok := sqlerrm like 'Add the link%'; end;
  insert into _r values ('hand-in needs link or file', ok, '');
  perform public.task_transition(t2, 'awaiting_review', 'Draft attached', 'https://example.com/brief');
  select status into v from public.tasks where id = t2;
  insert into _r values ('handed in', v = 'awaiting_review', v);
  c := public.task_add_comment(t2, 'Please check section 2');
  select count(*) into n from public.notifications where recipient_id = u_mgr and title = 'New comment on a task';
  insert into _r values ('comment notifies assigner', n = 1, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  begin perform public.task_transition(t2, 'completed'); ok := false; exception when others then ok := true; end;
  insert into _r values ('outsider cannot approve', ok, '');
  begin perform public.task_add_comment(t2, 'hi'); ok := false; exception when others then ok := true; end;
  insert into _r values ('outsider cannot comment', ok, '');
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.task_comments where task_id = t2;
  insert into _r values ('outsider cannot read comments (RLS)', n = 0, n::text);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  begin perform public.task_transition(t2, 'revision_required'); ok := false;
  exception when others then ok := sqlerrm like 'Say what%'; end;
  insert into _r values ('revision needs a note', ok, '');
  perform public.task_transition(t2, 'revision_required', 'Add pricing table');
  select count(*) into n from public.notifications where recipient_id = u_emp and title = 'Changes requested';
  insert into _r values ('assignee told about requested changes', n = 1, n::text);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.task_comments where task_id = t2;
  insert into _r values ('assigner reads comments (RLS)', n = 1, n::text);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.task_transition(t2, 'awaiting_review', null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  perform public.task_transition(t2, 'completed');
  select status into v from public.tasks where id = t2;
  insert into _r values ('reviewer approved', v = 'completed', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'in_progress');
  perform public.task_transition(t1, 'blocked', 'Waiting for client logo files');
  select count(*) into n from public.notifications where recipient_id = u_mgr and title = 'Task blocked';
  insert into _r values ('blocked notifies assigner', n = 1, n::text);
  perform public.task_transition(t1, 'in_progress');
  perform set_config('role', 'authenticated', true);
  update public.tasks set status = 'completed', submitted_link = 'https://example.com/logo' where id = t1;
  perform set_config('role', 'postgres', true);
  select status into v from public.tasks where id = t1;
  insert into _r values ('legacy completion still works for the live app', v = 'completed', v);
  perform set_config('sigma.task_rpc', 'on', true);
  update public.tasks set status = 'in_progress', time_spent_minutes = 0 where id = t1;
  perform set_config('sigma.task_rpc', '', true);
  perform set_config('role', 'authenticated', true);
  update public.tasks set time_spent_minutes = 9999, progress_pct = 5, completed_at = now() where id = t1;
  perform set_config('role', 'postgres', true);
  select time_spent_minutes into n from public.tasks where id = t1;
  insert into _r values ('direct update cannot forge workflow fields', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  begin perform public.task_transition(t1, 'cancelled', 'no'); ok := false; exception when others then ok := true; end;
  insert into _r values ('assignee cannot cancel', ok, '');
  perform set_config('request.jwt.claims', '', true);
  perform set_config('sigma.task_rpc', 'on', true);
  update public.tasks set status = 'in_progress', due_date = v_today + 1, start_date = v_today where id = t1;
  perform set_config('sigma.task_rpc', '', true);
  n := private.send_task_due_reminders();
  select count(*) into n from public.notifications where recipient_id = u_emp and title = 'Task due tomorrow';
  perform private.send_task_due_reminders();
  select count(*) - n into n from public.notifications where recipient_id = u_emp and title = 'Task due tomorrow';
  insert into _r values ('due reminder sent once', n = 0 and exists (select 1 from public.notifications where recipient_id = u_emp and title = 'Task due tomorrow'), n::text);
  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 160)))
    into failed, results from _r;
  raise exception 'TASK_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
exception when others then
 perform set_config('role','postgres',true);
 insert into _all values (sqlerrm);
end
$test$;
do $$ declare r text; begin
select string_agg(case when m ~ '^[A-Z_]+_TEST_RESULTS \{' then
 split_part(m,' ',1)||' failed='||((substr(m,position('{' in m)))::jsonb->>'failed')||'/'||((substr(m,position('{' in m)))::jsonb->>'total')||' '||
 coalesce((select string_agg(x->>'test'||': '||coalesce(x->>'detail',''),' | ') from jsonb_array_elements((substr(m,position('{' in m)))::jsonb->'results') x where not (x->>'ok')::boolean),'')
 else 'ERROR: '||left(m,500) end, E'\n') into r from _all;
if exists (select 1 from _all where not (m ~ '^[A-Z_]+_TEST_RESULTS \{' and ((substr(m,position('{' in m)))::jsonb->>'failed')='0')) then
 raise exception 'NOT APPLIED %', r; end if;
insert into supabase_migrations.schema_migrations(version, name) values
('20261023100000','task_workflow'),('20261023110000','leave_approvals'),('20261023120000','performance'),
('20261023130000','client_collaboration'),('20261023140000','client_team'),('20261023150000','review_flow'),('20261023170000','task_people');
end $$;
commit;
select string_agg(split_part(m,' ',1)||'='||((substr(m,position('{' in m)))::jsonb->>'failed')||'/'||((substr(m,position('{' in m)))::jsonb->>'total'),' ') as applied_tests from _all;