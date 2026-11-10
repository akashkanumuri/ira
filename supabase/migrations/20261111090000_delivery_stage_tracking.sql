-- SIGMA 1 — delivery visibility: how long a deliverable has sat in its current stage,
-- and one read for the "where is everything" board. Additive only: no column or row is removed.

-- 1. When a deliverable's status changes, remember when it entered that stage.
--    "Days stuck" is days in the CURRENT stage, not days since the work started, so a long
--    job that is still moving does not look like a problem.
alter table public.deliverables add column if not exists stage_since timestamptz;

update public.deliverables
   set stage_since = coalesce(stage_since, updated_at, created_at)
 where stage_since is null;

create or replace function private.deliverable_stage_clock()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if TG_OP = 'INSERT' then
    NEW.stage_since := coalesce(NEW.stage_since, now());
  elsif NEW.status is distinct from OLD.status then
    NEW.stage_since := now();
  else
    NEW.stage_since := OLD.stage_since;
  end if;
  return NEW;
end $function$;

drop trigger if exists deliverable_stage_clock on public.deliverables;
create trigger deliverable_stage_clock before insert or update on public.deliverables
  for each row execute function private.deliverable_stage_clock();

-- 2. Which side the ball is on, in plain words. Used by the board and by the journey view.
create or replace function private.deliverable_waiting_side(p_status text)
 returns text language sql immutable set search_path to ''
as $function$
  select case p_status
    when 'Awaiting Client Review' then 'client'
    when 'Awaiting Client Dependency' then 'client'
    when 'Modification Requested' then 'us'
    when 'Completed' then 'done'
    when 'Ready for Download' then 'done'
    when 'Cancelled' then 'done'
    else 'us'
  end
$function$;

-- 3. One read for the delivery board: every open deliverable a staff member may see,
--    with how long it has been in its stage, who it waits on, and its task counts.
create or replace function public.staff_delivery_board()
 returns table (
   deliverable_id uuid, deliverable_name text, project_id uuid, project_name text,
   client_id uuid, client_name text, due_date date, status text, lock_state text,
   stage_since timestamptz, days_in_stage integer, waiting_side text, waiting_on text,
   tasks_total integer, tasks_done integer, tasks_unassigned integer, overdue boolean
 )
 language plpgsql security definer set search_path to ''
as $function$
begin
  perform private.require(private.is_admin() or private.current_employee_id() is not null, 'Staff only');
  return query
  with mine as (
    select d.*
      from public.deliverables d
     where d.deleted_at is null
       and d.status not in ('Completed', 'Cancelled', 'Ready for Download')
       and (private.is_admin() or private.can_manage_project(d.project_id)
            or exists (select 1 from public.tasks t
                        where t.deliverable_id = d.id and t.archived_at is null
                          and t.assigned_to = private.current_employee_id()))
  ), counts as (
    select t.deliverable_id,
           count(*)::int as total,
           count(*) filter (where t.status = 'completed')::int as done,
           count(*) filter (where t.assigned_to is null)::int as unassigned
      from public.tasks t
     where t.archived_at is null
     group by t.deliverable_id
  )
  select m.id, m.name, m.project_id, p.name, m.client_id, c.company_name, m.due_date, m.status, m.lock_state,
         m.stage_since,
         greatest(0, (extract(epoch from (now() - coalesce(m.stage_since, m.updated_at, m.created_at))) / 86400)::int),
         private.deliverable_waiting_side(m.status),
         case
           when private.deliverable_waiting_side(m.status) = 'client' then coalesce(c.company_name, 'the client')
           when coalesce(cn.total, 0) = 0 then 'no tasks created yet'
           when coalesce(cn.unassigned, 0) > 0 then 'nobody assigned'
           else coalesce(m.responsible_name, 'the team')
         end,
         coalesce(cn.total, 0), coalesce(cn.done, 0), coalesce(cn.unassigned, 0),
         (m.due_date is not null and m.due_date < (now() at time zone 'Asia/Kolkata')::date)
    from mine m
    left join public.projects p on p.id = m.project_id
    left join public.clients c on c.id = m.client_id
    left join counts cn on cn.deliverable_id = m.id
   order by 11 desc, 7 nulls last;  -- longest in its current stage first
end $function$;

revoke all on function public.staff_delivery_board() from public, anon;
grant execute on function public.staff_delivery_board() to authenticated;
