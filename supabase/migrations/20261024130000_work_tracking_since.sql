-- SIGMA 1 — work tracking: days before tracking began are not scored.
-- Before tracking_since, a day shows attendance (check-in/out, late) only; no away/effective time.
set local lock_timeout = '5s';
alter table public.work_settings add column if not exists tracking_since date not null default '2026-10-24';

create or replace function private.work_day_json(p_emp uuid, p_date date, p_with_segments boolean default true)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.attendance; e public.employees; c public.work_settings := private.work_cfg(); v jsonb; v_req int;
begin
  select * into a from public.attendance x where x.employee_id = p_emp and x.date = p_date;
  if not found or a.check_in_at is null then return null; end if;
  select * into e from public.employees where id = p_emp;
  if p_date < c.tracking_since then
    -- before work tracking existed: attendance facts only, no task/away accounting
    return jsonb_build_object('date', p_date, 'untracked', true,
      'check_in', a.check_in_at, 'check_out', a.check_out_at, 'open', a.check_out_at is null,
      'shift_start', to_char(coalesce(e.shift_start, time '09:00'), 'HH24:MI'), 'shift_end', to_char(coalesce(e.shift_end, time '18:00'), 'HH24:MI'),
      'late', (a.check_in_at at time zone 'Asia/Kolkata')::time > coalesce(e.shift_start, time '09:00'),
      'left_early', a.check_out_at is not null and (a.check_out_at at time zone 'Asia/Kolkata')::time < coalesce(e.shift_end, time '18:00')
                    and (a.check_out_at at time zone 'Asia/Kolkata')::time > (a.check_in_at at time zone 'Asia/Kolkata')::time,
      'tasks', '[]'::jsonb, 'segments', '[]'::jsonb);
  end if;
  v_req := case when a.status = 'half_day' then c.required_minutes / 2 else c.required_minutes end;
  with s as (
    select g.*, extract(epoch from (g.seg_end - g.seg_start)) / 60.0 as m from private.work_segments(p_emp, p_date) g
  ), sm as (
    select coalesce(sum(m) filter (where kind = 'task'), 0) as task_m,
           coalesce(sum(m) filter (where kind = 'meeting'), 0) as meet_m,
           coalesce(sum(m) filter (where kind = 'break'), 0) as break_m,
           coalesce(sum(m) filter (where kind = 'away'), 0) as away_m,
           coalesce(sum(m) filter (where kind = 'buffer'), 0) as buffer_m,
           coalesce(sum(m) filter (where reason = 'break_overrun'), 0) as overrun_m,
           count(*) filter (where kind = 'away') as away_n,
           coalesce(sum(m), 0) as gross_m
    from s
  )
  select jsonb_build_object(
    'date', p_date,
    'check_in', a.check_in_at, 'check_out', a.check_out_at, 'open', a.check_out_at is null,
    'shift_start', to_char(coalesce(e.shift_start, time '09:00'), 'HH24:MI'), 'shift_end', to_char(coalesce(e.shift_end, time '18:00'), 'HH24:MI'),
    'late', (a.check_in_at at time zone 'Asia/Kolkata')::time > coalesce(e.shift_start, time '09:00'),
    'left_early', a.check_out_at is not null and (a.check_out_at at time zone 'Asia/Kolkata')::time < coalesce(e.shift_end, time '18:00')
                  and (a.check_out_at at time zone 'Asia/Kolkata')::time > (a.check_in_at at time zone 'Asia/Kolkata')::time,
    'gross_min', round(sm.gross_m), 'task_min', round(sm.task_m), 'meeting_min', round(sm.meet_m), 'break_min', round(sm.break_m),
    'away_min', round(sm.away_m), 'buffer_min', round(sm.buffer_m), 'overrun_min', round(sm.overrun_m), 'away_count', sm.away_n,
    'effective_min', round(sm.task_m + sm.meet_m), 'required_min', v_req,
    'effective_pct', round(100.0 * (sm.task_m + sm.meet_m) / nullif(v_req, 0), 1),
    'productivity_pct', round(100.0 * sm.task_m / nullif(sm.gross_m - sm.break_m, 0), 1),
    'meeting_over_cap', sm.meet_m > c.meeting_cap_minutes,
    'below_min', a.check_out_at is not null and 100.0 * (sm.task_m + sm.meet_m) / nullif(v_req, 0) < c.min_effective_pct,
    'checks_answered', (select count(*) from public.progress_checks k where k.employee_id = p_emp and k.is_presence and k.status = 'answered'
                         and (k.asked_at at time zone 'Asia/Kolkata')::date = p_date),
    'checks_missed', (select count(*) from public.progress_checks k where k.employee_id = p_emp and k.is_presence and k.status = 'missed'
                       and (k.asked_at at time zone 'Asia/Kolkata')::date = p_date),
    'drafts', (select count(*) from public.task_drafts d join public.tasks t on t.id = d.task_id
               where t.assigned_to = p_emp and (d.submitted_at at time zone 'Asia/Kolkata')::date = p_date),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('task_id', x.task_id, 'title', x.label, 'minutes', round(x.m)) order by x.m desc), '[]'::jsonb)
              from (select task_id, max(label) as label, sum(m) as m from s where kind = 'task' group by task_id) x),
    'segments', case when p_with_segments then (select coalesce(jsonb_agg(jsonb_build_object('start', seg_start, 'end', seg_end, 'kind', kind,
                  'label', label, 'task_id', task_id, 'reason', reason, 'minutes', round(m)) order by seg_start), '[]'::jsonb) from s) else null end
  ) into v from sm;
  return v;
end $$;

create or replace function private.work_month_json(p_emp uuid, p_month date, p_with_days boolean default true)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.work_settings := private.work_cfg(); v_from date := date_trunc('month', p_month)::date;
  v_to date := least((date_trunc('month', p_month) + interval '1 month - 1 day')::date, private.today_ist());
  d date; dj jsonb; days jsonb := '[]'::jsonb; v_kind text;
  n_work int := 0; n_present int := 0; n_leave int := 0; n_absent int := 0; n_late int := 0; n_below int := 0; n_overrun int := 0;
  t_eff numeric := 0; t_task numeric := 0; t_meet numeric := 0; t_break numeric := 0; t_away numeric := 0; t_gross numeric := 0; t_req numeric := 0;
  t_ans int := 0; t_miss int := 0; v_in_sum numeric := 0; n_tracked int := 0;
  s_time numeric; s_dead numeric; s_qual numeric; w numeric; score numeric;
  k_due int; k_ontime int; q_first int; q_ok int;
begin
  if v_to < v_from then v_to := v_from - 1; end if;
  d := v_from;
  while d <= v_to loop
    dj := private.work_day_json(p_emp, d, false);
    if dj is not null and coalesce((dj->>'untracked')::boolean, false) then
      v_kind := 'present'; n_present := n_present + 1; n_work := n_work + 1;
      if (dj->>'late')::boolean then n_late := n_late + 1; end if;
      v_in_sum := v_in_sum + extract(epoch from (((dj->>'check_in')::timestamptz at time zone 'Asia/Kolkata')::time));
    elsif dj is not null then
      v_kind := 'present'; n_present := n_present + 1; n_work := n_work + 1; n_tracked := n_tracked + 1;
      t_eff := t_eff + (dj->>'effective_min')::numeric; t_task := t_task + (dj->>'task_min')::numeric; t_meet := t_meet + (dj->>'meeting_min')::numeric;
      t_break := t_break + (dj->>'break_min')::numeric; t_away := t_away + (dj->>'away_min')::numeric; t_gross := t_gross + (dj->>'gross_min')::numeric;
      t_req := t_req + (dj->>'required_min')::numeric;
      t_ans := t_ans + (dj->>'checks_answered')::int; t_miss := t_miss + (dj->>'checks_missed')::int;
      if (dj->>'late')::boolean then n_late := n_late + 1; end if;
      if (dj->>'below_min')::boolean then n_below := n_below + 1; end if;
      if (dj->>'overrun_min')::numeric > 0 then n_overrun := n_overrun + 1; end if;
      v_in_sum := v_in_sum + extract(epoch from (((dj->>'check_in')::timestamptz at time zone 'Asia/Kolkata')::time));
    elsif exists (select 1 from public.leave_requests l where l.employee_id = p_emp and l.status = 'approved' and d between l.start_date and l.end_date) then
      v_kind := 'leave'; n_leave := n_leave + 1; n_work := n_work + 1;
    elsif extract(isodow from d) = 7 or exists (select 1 from public.holidays h where h.date = d) then
      v_kind := 'off';
    elsif d < private.today_ist() then
      v_kind := 'absent'; n_absent := n_absent + 1; n_work := n_work + 1;
    else
      v_kind := 'today';
    end if;
    if p_with_days then
      days := days || jsonb_build_array(coalesce(dj, '{}'::jsonb) || jsonb_build_object('date', d, 'kind', v_kind));
    end if;
    d := d + 1;
  end loop;

  -- deadlines: tasks due this month finished by the due date
  select count(*) filter (where on_time or late or overdue), count(*) filter (where on_time) into k_due, k_ontime
  from (select (k.status = 'completed' and (k.completed_at at time zone 'Asia/Kolkata')::date <= k.due_date) as on_time,
               (k.status = 'completed' and (k.completed_at at time zone 'Asia/Kolkata')::date > k.due_date) as late,
               (k.status not in ('completed','awaiting_review') and k.due_date < private.today_ist()) as overdue
        from public.tasks k where k.assigned_to = p_emp and k.archived_at is null and k.status <> 'cancelled'
          and k.due_date between v_from and v_to) z;
  -- quality: first drafts decided this month that were approved
  select count(*), count(*) filter (where f.decision in ('approved','auto_approved')) into q_first, q_ok
  from (select distinct on (dr.task_id) dr.task_id, dr.decision, dr.decided_at
        from public.task_drafts dr join public.tasks k on k.id = dr.task_id
        where k.assigned_to = p_emp order by dr.task_id, dr.draft_no) f
  where f.decision <> 'pending' and (f.decided_at at time zone 'Asia/Kolkata')::date between v_from and v_to;

  s_time := case when t_req > 0 then least(100, round(100.0 * t_eff / t_req, 1)) end;
  s_dead := case when k_due > 0 then round(100.0 * k_ontime / k_due, 1) end;
  s_qual := case when q_first > 0 then round(100.0 * q_ok / q_first, 1) end;
  w := (case when s_time is not null then c.weight_time else 0 end) + (case when s_dead is not null then c.weight_deadlines else 0 end)
     + (case when s_qual is not null then c.weight_quality else 0 end);
  score := case when w > 0 then round((coalesce(s_time, 0) * c.weight_time * (s_time is not null)::int
                                   + coalesce(s_dead, 0) * c.weight_deadlines * (s_dead is not null)::int
                                   + coalesce(s_qual, 0) * c.weight_quality * (s_qual is not null)::int) / w) end;

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'working_days', n_work, 'present', n_present, 'leave', n_leave, 'absent', n_absent,
    'late_days', n_late, 'below_min_days', n_below, 'overrun_days', n_overrun,
    'avg_check_in', case when n_present > 0 then to_char(time '00:00' + make_interval(secs => v_in_sum / n_present), 'HH24:MI') end,
    'effective_min', round(t_eff), 'task_min', round(t_task), 'meeting_min', round(t_meet), 'break_min', round(t_break),
    'away_min', round(t_away), 'gross_min', round(t_gross), 'required_min', round(t_req),
    'avg_effective_min', case when n_tracked > 0 then round(t_eff / n_tracked) end, 'tracked_days', n_tracked, 'tracking_since', c.tracking_since,
    'effectiveness_pct', s_time,
    'productivity_pct', round(100.0 * t_task / nullif(t_gross - t_break, 0), 1),
    'tasks_due', k_due, 'tasks_on_time', k_ontime, 'deadline_pct', s_dead,
    'first_drafts', q_first, 'first_draft_ok', q_ok, 'quality_pct', s_qual,
    'checks_answered', t_ans, 'checks_missed', t_miss,
    'score', score, 'weights', jsonb_build_object('time', c.weight_time, 'deadlines', c.weight_deadlines, 'quality', c.weight_quality),
    'days', case when p_with_days then days else null end);
end $$;
