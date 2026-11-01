-- SIGMA 1 — dry-run logic fixes (1 Nov 2026)
--  F1/F2  Late = after the person's own start time + grace (per-person pattern), never for flexible schedules
--  F3     Check-in WFH messages match the real rule (WFH is requested a day ahead)
--  F4     Payroll deducts absent working days (no check-in, no leave) and short days, from 1 Nov 2026
--  F5     Payroll stops at the engagement end date
--  F6/F16 Leave, WFH requests and corrections use each person's working days, holidays and location
--  F8     An assignee can no longer complete their own task without review (legacy submit_task / direct update)
-- Additive only: two new payroll_records columns, one new payroll_settings column; no data changed.
set local lock_timeout = '5s';

-- ───────────────────────── late / early helpers ─────────────────────────
-- Minutes late (counted from the start time) once past the grace; 0 when on time, early, or no fixed start.
create or replace function private.late_minutes(p_emp uuid, p_date date, p_at timestamptz)
returns int language plpgsql stable security definer set search_path = '' as $$
declare dr jsonb; v_start time; v_grace int; v_d int;
begin
  if p_emp is null or p_date is null or p_at is null then return 0; end if;
  dr := private.day_rules(p_emp, p_date);
  if dr is null or dr->>'late_after' is null then return 0; end if;          -- flexible / project-based: never late
  v_start := coalesce((dr->'shift'->>'start')::time, (dr->'core'->>'start')::time);
  if v_start is null then return 0; end if;
  v_grace := mod((floor(extract(epoch from ((dr->>'late_after')::time - v_start)) / 60))::int + 2880, 1440);
  v_d := mod((floor(extract(epoch from ((p_at at time zone 'Asia/Kolkata')::time - v_start)) / 60))::int + 2880, 1440);
  if v_d > 720 or v_d <= v_grace then return 0; end if;                       -- > 12 h "late" means they came before the start
  return v_d;
end $$;

-- Minutes left before the end time, beyond the early-leave grace; 0 for flexible schedules.
create or replace function private.early_minutes(p_emp uuid, p_date date, p_out timestamptz)
returns int language plpgsql stable security definer set search_path = '' as $$
declare dr jsonb; v_end time; v_d int;
begin
  if p_emp is null or p_date is null or p_out is null then return 0; end if;
  dr := private.day_rules(p_emp, p_date);
  if dr is null then return 0; end if;
  v_end := coalesce((dr->'shift2'->>'end')::time, (dr->'shift'->>'end')::time, (dr->'core'->>'end')::time);
  if v_end is null then return 0; end if;
  v_d := mod((floor(extract(epoch from (v_end - (p_out at time zone 'Asia/Kolkata')::time)) / 60))::int + 2880, 1440);
  if v_d > 720 or v_d <= coalesce((dr->>'early_grace_minutes')::int, 0) then return 0; end if;
  return v_d;
end $$;

revoke all on function private.late_minutes(uuid, date, timestamptz) from public, anon, authenticated;
revoke all on function private.early_minutes(uuid, date, timestamptz) from public, anon, authenticated;

-- ───────────────────────── check-in: late status ─────────────────────────
create or replace function private.validate_attendance_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  eid uuid;
  local_date date := (now() at time zone 'Asia/Kolkata')::date;
  emp record; wfh record; leave_rec record; dr jsonb; v_refuse text;
  is_reg boolean := coalesce(current_setting('ira.regularization',true),'off')='on';
  is_admin_in boolean := coalesce(current_setting('ira.admin_checkin',true),'off')='on';
begin
  if is_reg or is_admin_in then eid := NEW.employee_id; else eid := private.current_employee_id(); end if;
  if eid is null then raise exception 'Active employee account required'; end if;
  if NEW.employee_id <> eid then raise exception 'Invalid employee'; end if;
  if not is_reg then
    NEW.date := local_date;
    if exists (select 1 from public.attendance a where a.employee_id=eid and a.date<NEW.date and a.current_state<>'completed') then
      raise exception 'Previous attendance is still open. Close or regularize the previous shift before checking in.';
    end if;
  end if;
  select e.* into emp from public.employees e where e.id=eid and e.status='active';
  if emp.id is null then raise exception 'Active employee record not found'; end if;
  if NEW.date < emp.join_date then raise exception 'Attendance cannot be recorded before the employee join date'; end if;
  dr := private.day_rules(eid, NEW.date);
  if not coalesce((dr->>'attendance')::boolean, true) and not is_reg and not is_admin_in then
    raise exception 'Attendance isn’t tracked for your account';
  end if;
  if not coalesce((dr->>'working_day')::boolean, true) then
    case dr->>'off_reason'
      when 'holiday' then raise exception 'This date is a company holiday';
      when 'weekly_off' then raise exception '%', case when extract(dow from NEW.date)=0 then 'Sunday is a weekly off' else 'This is your weekly off' end;
      when 'saturday_off' then raise exception 'This Saturday is your day off';
      when 'engagement_ended' then raise exception 'Your engagement has ended';
      else null;
    end case;
  end if;
  if dr->>'location' = 'home' then
    if NEW.mode <> 'wfh' then raise exception 'Remote employees must check in as WFH'; end if;
  elsif NEW.mode='wfh' then
    select wr.* into wfh from public.wfh_requests wr where wr.employee_id=eid and wr.date=NEW.date and wr.status='approved';
    if not is_reg and not is_admin_in then
      v_refuse := private.wfh_refusal(eid, NEW.date, dr);
      if v_refuse is not null then raise exception '%', v_refuse; end if;
    end if;
    NEW.wfh_request_id := wfh.id;
  end if;
  if not is_reg and not is_admin_in and dr->>'earliest_checkin' is not null
     and (now() at time zone 'Asia/Kolkata')::time < (dr->>'earliest_checkin')::time then
    raise exception 'Check-in opens at %', to_char((dr->>'earliest_checkin')::time, 'HH12:MI AM');
  end if;
  if NEW.mode='office' and not is_reg and not is_admin_in
     and coalesce(current_setting('ira.geo_checkin',true),'off') <> 'on'
     and coalesce((dr->>'geofence')::boolean, true)
     and exists (select 1 from public.office_location o where o.id and o.enabled) then
    raise exception 'Office check-in needs your location. Refresh the page and check in again.';
  end if;
  select lr.* into leave_rec from public.leave_requests lr where lr.employee_id=eid and lr.status='approved' and lr.start_date<=NEW.date and lr.end_date>=NEW.date limit 1;
  if leave_rec.id is not null then raise exception 'Approved leave exists for this date'; end if;
  if NEW.id is null then NEW.id:=extensions.uuid_generate_v4(); end if;
  if is_reg then
    if NEW.check_in_at is null or NEW.check_out_at is null then raise exception 'Regularization requires both check-in and check-out'; end if;
    NEW.current_state:='completed';
    NEW.working_seconds:=greatest(0,floor(extract(epoch from(NEW.check_out_at-NEW.check_in_at)))::integer-coalesce(NEW.total_break_seconds,0));
    NEW.total_break_seconds:=coalesce(NEW.total_break_seconds,0);
  else
    NEW.check_in_at:=case when is_admin_in then coalesce(NEW.check_in_at, now()) else now() end;
    NEW.check_out_at:=null; NEW.current_state:='working'; NEW.working_seconds:=0; NEW.total_break_seconds:=0;
  end if;
  -- F1/F2: the person's own start time plus grace; flexible schedules are never late
  NEW.status := case when private.late_minutes(eid, NEW.date, NEW.check_in_at) > 0 then 'late' else 'present' end;
  NEW.created_at:=coalesce(NEW.created_at,now());
  NEW.updated_at:=now();
  return NEW;
end;
$$;

-- ───────────────────────── F3: WFH messages ─────────────────────────
create or replace function private.wfh_refusal(p_employee_id uuid, p_date date, p_dr jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_extra text; r public.employee_work_rules%rowtype; h jsonb; v_pending boolean;
begin
  if p_dr->>'location' = 'home' then return null; end if;
  if exists (select 1 from public.wfh_requests w where w.employee_id = p_employee_id and w.date = p_date and w.status = 'approved') then return null; end if;
  r := private.work_rules_on(p_employee_id, p_date);
  v_extra := coalesce(r.extra_wfh, 'approval');
  if p_dr->>'location' = 'either' then
    h := private.hybrid_status(p_employee_id, p_date);
    if coalesce((h->>'home_left')::int, 0) > 0 then return null; end if;
    if v_extra = 'free' then return null; end if;
  elsif v_extra = 'free' then
    return null;
  end if;
  v_pending := exists (select 1 from public.wfh_requests w where w.employee_id = p_employee_id and w.date = p_date and w.status = 'pending');
  if v_pending then
    return 'Your WFH request for today hasn’t been approved yet. Check in at the office, or wait for approval.';
  end if;
  if p_dr->>'location' = 'either' then
    return case when v_extra = 'approval'
      then 'You’ve used this ' || coalesce(h->>'period', 'week') || '’s home days. Check in at the office today — extra WFH days must be requested at least a day ahead.'
      else 'You’ve used this ' || coalesce(h->>'period', 'week') || '’s home days. Check in at the office today.' end;
  end if;
  if r.location_mode = 'hybrid' then
    return case when v_extra = 'approval'
      then 'Today is one of your office days. Check in at the office — WFH must be requested at least a day ahead.'
      else 'Today is one of your office days.' end;
  end if;
  return case when v_extra = 'approval'
    then 'WFH isn’t approved for today. Check in at the office — WFH must be requested at least a day ahead.'
    else 'Work from home isn’t part of your work pattern.' end;
end $$;

-- ───────────────────────── F6: leave uses the person's days off ─────────────────────────
create or replace function private.calculate_leave_days_for(p_employee_id uuid, p_start date, p_end date, p_duration text)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare total numeric := 0; d date; dr jsonb;
begin
  if p_end < p_start then raise exception 'End date cannot be before start date'; end if;
  if date_trunc('month', p_start) <> date_trunc('month', p_end) then
    raise exception 'A leave request must stay within one calendar month';
  end if;
  if p_duration = 'half' and p_start <> p_end then raise exception 'Half-day leave must use one date'; end if;
  d := p_start;
  while d <= p_end loop
    dr := private.day_rules(p_employee_id, d);
    if coalesce((dr->>'working_day')::boolean, extract(dow from d) <> 0) then
      total := total + case when p_duration = 'half' and p_start = p_end then 0.5 else 1 end;
    end if;
    d := d + 1;
  end loop;
  return total;
end $$;
revoke all on function private.calculate_leave_days_for(uuid, date, date, text) from public, anon, authenticated;

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
  dr jsonb;
begin
  new.leave_type := lower(btrim(new.leave_type));
  if private.is_admin() then
    if new.manager_status is null then new.manager_status := 'skipped'; end if;
    return new;
  end if;
  if eid is null or new.employee_id <> eid then raise exception 'Unauthorized leave request'; end if;
  if new.status <> 'pending' then raise exception 'New leave request must be pending'; end if;
  dr := private.day_rules(eid, new.start_date);
  if dr is not null and (dr->'features'->>'leave') = 'false' then
    raise exception 'Leave isn’t part of your work pattern';
  end if;
  select * into t from public.leave_types where code = new.leave_type and active;
  if not found then raise exception 'Choose a valid leave type'; end if;
  if new.duration = 'half' and not t.allow_half_day then raise exception '% leave can’t be taken as a half day', t.name; end if;
  if t.min_notice_days > 0 and new.start_date < v_today + t.min_notice_days then
    raise exception '% leave needs % day(s) notice', t.name, t.min_notice_days;
  end if;
  calculated := private.calculate_leave_days_for(eid, new.start_date, new.end_date, new.duration);
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

-- ───────────────────────── F6: WFH requests use the person's pattern ─────────────────────────
create or replace function private.validate_wfh_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  eid uuid := private.current_employee_id();
  dr jsonb;
begin
  if private.is_admin() then return new; end if;
  if eid is null or new.employee_id <> eid then raise exception 'Unauthorized WFH request'; end if;
  if new.status <> 'pending' then raise exception 'New WFH request must be pending'; end if;
  if not exists (select 1 from public.employees where id = eid and status = 'active') then
    raise exception 'Active employee record not found';
  end if;
  if new.date <= (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'WFH must be requested before the work date';
  end if;
  dr := private.day_rules(eid, new.date);
  if dr->>'location' = 'home' then raise exception 'Remote employees do not need a WFH request'; end if;
  if (dr->'features'->>'wfh') = 'false' then raise exception 'Work from home isn’t part of your work pattern'; end if;
  if not coalesce((dr->>'working_day')::boolean, true) then
    case dr->>'off_reason'
      when 'holiday' then raise exception 'Selected date is a company holiday';
      when 'weekly_off' then raise exception '%', case when extract(dow from new.date)=0 then 'Sunday is a weekly off' else 'That date is your weekly off' end;
      when 'saturday_off' then raise exception 'That Saturday is your day off';
      when 'engagement_ended' then raise exception 'Your engagement has ended by that date';
      when 'before_join' then raise exception 'That date is before your joining date';
      else raise exception 'That date isn’t a working day for you';
    end case;
  end if;
  if exists (
    select 1 from public.wfh_requests wr
    where wr.employee_id = eid and wr.date = new.date and wr.status in ('pending','approved') and wr.id <> new.id
  ) then
    raise exception 'A pending or approved WFH request already exists for this date';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ───────────────────────── F16: corrections use the person's pattern ─────────────────────────
create or replace function private.validate_regularization()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  eid uuid := private.current_employee_id();
  a public.attendance%rowtype;
  emp_join date;
  local_date date := (now() at time zone 'Asia/Kolkata')::date;
  in_minutes integer;
  out_minutes integer;
  dr jsonb;
begin
  if private.is_admin() then return new; end if;
  if eid is null or new.employee_id<>eid then raise exception 'Unauthorized correction request'; end if;
  if new.status<>'pending' then raise exception 'New correction must be pending'; end if;
  if new.date>local_date then raise exception 'Correction cannot be for a future date'; end if;
  select e.join_date into emp_join from public.employees e where e.id=eid and e.status='active';
  if emp_join is null then raise exception 'Active employee record not found'; end if;
  if new.date<emp_join then raise exception 'Correction cannot be before the employee join date'; end if;
  dr := private.day_rules(eid, new.date);
  if (dr->>'attendance') = 'false' then raise exception 'Attendance isn’t tracked for your account'; end if;
  if not coalesce((dr->>'working_day')::boolean, true) then
    case dr->>'off_reason'
      when 'holiday' then raise exception 'This date is a company holiday';
      when 'weekly_off' then raise exception '%', case when extract(dow from new.date)=0 then 'Sunday is a weekly off' else 'This date is your weekly off' end;
      when 'saturday_off' then raise exception 'This Saturday is your day off';
      when 'engagement_ended' then raise exception 'Your engagement had ended by this date';
      else raise exception 'This date isn’t a working day for you';
    end case;
  end if;
  if exists(
    select 1 from public.leave_requests lr
    where lr.employee_id=eid and lr.status='approved' and lr.start_date<=new.date and lr.end_date>=new.date
  ) then
    raise exception 'Approved leave exists for this date';
  end if;
  if new.requested_check_in !~ '^[0-2][0-9]:[0-5][0-9]$' or new.requested_check_out !~ '^[0-2][0-9]:[0-5][0-9]$' then
    raise exception 'Correction times must use HH:MM format';
  end if;
  in_minutes := split_part(new.requested_check_in,':',1)::integer*60 + split_part(new.requested_check_in,':',2)::integer;
  out_minutes := split_part(new.requested_check_out,':',1)::integer*60 + split_part(new.requested_check_out,':',2)::integer;
  if in_minutes>=1440 or out_minutes>=1440 or out_minutes<=in_minutes then
    raise exception 'Correction check-out must be later than check-in';
  end if;
  select * into a from public.attendance where employee_id=eid and date=new.date limit 1;
  new.attendance_id:=a.id;
  new.original_check_in:=a.check_in_at;
  new.original_check_out:=a.check_out_at;
  new.updated_at:=now();
  return new;
end;
$$;

create or replace function private.apply_regularization_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  local_checkin timestamptz;
  local_checkout timestamptz;
  new_attendance_id uuid;
  a public.attendance%rowtype;
begin
  if NEW.status = OLD.status then
    NEW.updated_at := now();
    return NEW;
  end if;
  if not private.is_admin() then raise exception 'Only admin can review corrections'; end if;
  if OLD.status <> 'pending' then raise exception 'Only pending corrections can be reviewed'; end if;
  NEW.reviewed_at := now();
  NEW.reviewed_by := (select auth.uid());
  if NEW.status = 'approved' then
    local_checkin := ((NEW.date + NEW.requested_check_in) at time zone 'Asia/Kolkata');
    local_checkout := ((NEW.date + NEW.requested_check_out) at time zone 'Asia/Kolkata');
    if NEW.attendance_id is null then
      -- Additive: create the attendance row that did not exist. Existing attendance is never updated by regularization.
      perform set_config('ira.regularization','on',true);
      insert into public.attendance(employee_id, date, mode, check_in_at, check_out_at, working_seconds,
                                    total_break_seconds, current_state, status, notes)
      select NEW.employee_id, NEW.date,
        case
          when private.day_rules(e.id, NEW.date)->>'location' = 'home' then 'wfh'
          when exists(select 1 from public.wfh_requests wr where wr.employee_id = e.id and wr.date = NEW.date and wr.status = 'approved') then 'wfh'
          else 'office'
        end,
        local_checkin, local_checkout,
        greatest(0, floor(extract(epoch from (local_checkout - local_checkin)))::integer),
        0, 'completed',
        case when private.late_minutes(e.id, NEW.date, local_checkin) > 0 then 'late' else 'present' end,
        'Created from approved attendance regularization'
      from public.employees e
      where e.id = NEW.employee_id
      returning id into new_attendance_id;
      perform set_config('ira.regularization','off',true);
      if new_attendance_id is null then raise exception 'Employee not found for correction'; end if;
      NEW.attendance_id := new_attendance_id;
      insert into public.attendance_events(attendance_id, event_type, event_at, metadata)
      values(NEW.attendance_id, 'regularization', now(), jsonb_build_object(
        'request_id', NEW.id, 'original_check_in', NEW.original_check_in, 'original_check_out', NEW.original_check_out,
        'requested_check_in', NEW.requested_check_in, 'requested_check_out', NEW.requested_check_out,
        'immutable', true, 'created_attendance', true));
    else
      select * into a from public.attendance where id = NEW.attendance_id;
      if a.id is null then raise exception 'Attendance record not found for correction'; end if;
      -- Immutable history: the original row stays as recorded; attendance_effective applies the correction at read time.
      insert into public.attendance_events(attendance_id, event_type, event_at, metadata)
      values(a.id, 'regularization', now(), jsonb_build_object(
        'request_id', NEW.id, 'original_check_in', NEW.original_check_in, 'original_check_out', NEW.original_check_out,
        'requested_check_in', NEW.requested_check_in, 'requested_check_out', NEW.requested_check_out,
        'immutable', true, 'created_attendance', false));
    end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

-- ───────────────────────── punctuality + work day: same late rule ─────────────────────────
create or replace function public.employee_punctuality(p_employee_id uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp uuid := coalesce(p_employee_id, private.current_employee_id());
  v_from date := coalesce(p_from, private.today_ist() - 29);
  v_to date := least(coalesce(p_to, private.today_ist()), private.today_ist());
  v_today date := private.today_ist();
  e public.employees;
  v jsonb;
  v_dr jsonb;
begin
  perform private.require(v_emp is not null, 'Employee not found');
  perform private.require(v_emp = private.current_employee_id() or private.is_manager_of(v_emp) or private.can_manage_performance(), 'Not allowed');
  select * into e from public.employees where id = v_emp;
  perform private.require(found, 'Employee not found');
  v_dr := private.day_rules(v_emp, v_today);
  with a as (
    select x.date, x.check_in_at, x.check_out_at, coalesce(x.total_break_seconds, 0) as break_s,
           (x.check_in_at at time zone 'Asia/Kolkata')::time as cin,
           (x.check_out_at at time zone 'Asia/Kolkata')::time as cout
    from public.attendance_effective x
    where x.employee_id = v_emp and x.date between v_from and v_to and x.check_in_at is not null
  ), d as (
    select a.*,
           private.late_minutes(v_emp, a.date, a.check_in_at) as late_min,
           case when a.check_out_at is not null then private.early_minutes(v_emp, a.date, a.check_out_at) else 0 end as early_min
    from a
  ), t as (
    select k.status, k.due_date, (k.completed_at at time zone 'Asia/Kolkata')::date as done_on
    from public.tasks k
    where k.assigned_to = v_emp and k.archived_at is null and k.status <> 'cancelled' and k.due_date between v_from and v_to
  ), td as (
    select t.*,
           (t.status = 'completed' and t.done_on <= t.due_date) as on_time,
           (t.status = 'completed' and t.done_on > t.due_date) as late,
           (t.status not in ('completed','awaiting_review') and t.due_date < v_today) as overdue
    from t
  ), dr as (
    select x.on_time from public.task_drafts x join public.tasks k on k.id = x.task_id
    where k.assigned_to = v_emp and (x.submitted_at at time zone 'Asia/Kolkata')::date between v_from and v_to
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'shift_start', to_char(coalesce(e.shift_start, time '09:00'), 'HH24:MI'),
    'shift_end', to_char(coalesce(e.shift_end, time '18:00'), 'HH24:MI'),
    'late_after', case when v_dr->>'late_after' is not null then to_char((v_dr->>'late_after')::time, 'HH24:MI') end,
    'flexible', v_dr->>'late_after' is null,
    'days_present', (select count(*) from d),
    'on_time_days', (select count(*) from d where late_min = 0),
    'late_days', (select count(*) from d where late_min > 0),
    'on_time_rate', (select round(100.0 * count(*) filter (where late_min = 0) / nullif(count(*), 0), 1) from d),
    'avg_late_minutes', (select round(avg(late_min)) from d where late_min > 0),
    'total_late_minutes', (select coalesce(sum(late_min), 0) from d),
    'early_leave_days', (select count(*) from d where early_min > 0),
    'avg_early_minutes', (select round(avg(early_min)) from d where early_min > 0),
    'missed_checkout_days', (select count(*) from d where check_out_at is null and date < v_today),
    'avg_check_in', (select to_char(time '00:00' + make_interval(secs => avg(extract(epoch from cin))), 'HH24:MI') from d),
    'avg_break_minutes', (select round(avg(break_s) / 60.0) from d),
    'days', coalesce((select jsonb_agg(jsonb_build_object('date', date, 'in', to_char(cin, 'HH24:MI'), 'out', to_char(cout, 'HH24:MI'),
                       'late', late_min, 'early', early_min) order by date) from d), '[]'::jsonb),
    'tasks_due', (select count(*) from td where on_time or late or overdue),
    'tasks_on_time', (select count(*) from td where on_time),
    'tasks_late', (select count(*) from td where late),
    'tasks_overdue', (select count(*) from td where overdue),
    'task_on_time_rate', (select round(100.0 * count(*) filter (where on_time) / nullif(count(*) filter (where on_time or late or overdue), 0), 1) from td),
    'avg_days_late', (select round(avg(done_on - due_date), 1) from td where late),
    'drafts', (select count(*) from dr),
    'drafts_on_time', (select count(*) from dr where on_time is not false),
    'draft_on_time_rate', (select round(100.0 * count(*) filter (where on_time is not false) / nullif(count(*), 0), 1) from dr)
  ) into v;
  return v;
end $$;

-- work_day_json: swap only the 'late' expression, keep the rest of the live function as it is
do $$
declare src text; n int;
begin
  src := pg_get_functiondef('private.work_day_json(uuid,date,boolean)'::regprocedure);
  n := (length(src) - length(replace(src, '''late'', (a.check_in_at at time zone ''Asia/Kolkata'')::time > coalesce(e.shift_start, time ''09:00'')', ''))) /
       length('''late'', (a.check_in_at at time zone ''Asia/Kolkata'')::time > coalesce(e.shift_start, time ''09:00'')');
  if n = 0 and position('private.late_minutes' in src) = 0 then raise exception 'work_day_json late expression not found'; end if;
  if n > 0 then
    src := replace(src, '''late'', (a.check_in_at at time zone ''Asia/Kolkata'')::time > coalesce(e.shift_start, time ''09:00'')',
                        '''late'', private.late_minutes(p_emp, p_date, a.check_in_at) > 0');
    execute src;
  end if;
end $$;

-- ───────────────────────── F8: no self-completion without review ─────────────────────────
-- Legacy RPC (unused by the app): hand-ins now go through review like the app does.
create or replace function public.submit_task(p_task_id uuid, p_submitted_link text)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  perform public.task_transition(p_task_id, 'awaiting_review', null, p_submitted_link);
  return p_task_id;
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
  -- status and hand-in fields only change through task_transition (start / hand in / approve / send back)
  NEW.status := OLD.status;
  NEW.submitted_link := OLD.submitted_link;
  NEW.submitted_at := OLD.submitted_at;
  NEW.progress_pct := OLD.progress_pct;
  if is_assignee and not is_assigner then
    NEW.title := OLD.title; NEW.description := OLD.description;
    NEW.assigned_to := OLD.assigned_to; NEW.assigned_by := OLD.assigned_by;
    NEW.start_date := OLD.start_date; NEW.due_date := OLD.due_date; NEW.priority := OLD.priority;
    NEW.project_id := OLD.project_id; NEW.deliverable_id := OLD.deliverable_id;
    NEW.archived_at := OLD.archived_at;
    return NEW;
  end if;
  if is_assigner then
    if NEW.assigned_to <> OLD.assigned_to and not private.can_assign_task(NEW.assigned_to) then
      raise exception 'You are not allowed to assign this employee';
    end if;
    NEW.assigned_by := OLD.assigned_by;
    return NEW;
  end if;
  raise exception 'Unauthorized task update';
end $$;

-- ───────────────────────── nightly pattern sync could not update employees ─────────────────────────
-- private.work_rules_daily_sync (cron, no user) calls sync_employee_legacy, which protect_employee_update
-- rejected as 'Unauthorized employee update' the first time a future-dated pattern took effect.
create or replace function private.sync_employee_legacy(p_employee_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.employee_work_rules%rowtype;
begin
  r := private.work_rules_on(p_employee_id, (now() at time zone 'Asia/Kolkata')::date);
  if r.id is null then return; end if;
  perform set_config('sigma.rules_sync', 'on', true);
  update public.employees e set
    work_mode = case when r.location_mode = 'remote' then 'remote' else 'office' end,
    shift_start = case r.schedule_type when 'flexible_core' then r.core_start when 'flexible' then e.shift_start else r.shift_start end,
    shift_end   = case r.schedule_type when 'flexible_core' then r.core_end   when 'flexible' then e.shift_end   else coalesce(r.shift2_end, r.shift_end) end
  where e.id = p_employee_id
    and (e.work_mode, e.shift_start, e.shift_end) is distinct from (
      case when r.location_mode = 'remote' then 'remote' else 'office' end,
      case r.schedule_type when 'flexible_core' then r.core_start when 'flexible' then e.shift_start else r.shift_start end,
      case r.schedule_type when 'flexible_core' then r.core_end when 'flexible' then e.shift_end else coalesce(r.shift2_end, r.shift_end) end);
  perform set_config('sigma.rules_sync', '', true);
end $$;

create or replace function private.employee_legacy_only(o public.employees, n public.employees)
returns public.employees language plpgsql stable set search_path = '' as $$
declare r public.employees := o;
begin
  r.work_mode := n.work_mode; r.shift_start := n.shift_start; r.shift_end := n.shift_end; r.updated_at := now();
  return r;
end $$;
revoke all on function private.employee_legacy_only(public.employees, public.employees) from public, anon, authenticated;

create or replace function private.protect_employee_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true),'') = 'service_role' or private.is_admin() then
    NEW.updated_at := now();
    return NEW;
  end if;
  if coalesce(current_setting('sigma.rules_sync', true), '') = 'on' then
    -- pattern sync: only the legacy work_mode / shift columns may change
    return private.employee_legacy_only(OLD, NEW);
  end if;
  if private.current_employee_id() is null or OLD.id <> private.current_employee_id() then
    raise exception 'Unauthorized employee update';
  end if;
  NEW.profile_id := OLD.profile_id;
  NEW.emp_id := OLD.emp_id;
  NEW.login_id := OLD.login_id;
  NEW.status := OLD.status;
  NEW.work_mode := OLD.work_mode;
  NEW.shift_start := OLD.shift_start;
  NEW.shift_end := OLD.shift_end;
  NEW.join_date := OLD.join_date;
  NEW.department_id := OLD.department_id;
  NEW.designation_id := OLD.designation_id;
  NEW.manager_id := OLD.manager_id;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  return NEW;
end;
$$;

-- ───────────────────────── F4/F5: payroll absent days + engagement end ─────────────────────────
alter table public.payroll_records add column if not exists absent_days numeric(6,2) not null default 0;
alter table public.payroll_records add column if not exists absent_deduction numeric(12,2) not null default 0;
-- absent days are only counted from this date (earlier months had no reliable check-ins)
alter table public.payroll_settings add column if not exists absent_from date not null default '2026-11-01';

create or replace function private.payroll_absent_days(p_emp uuid, p_from date, p_to date)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare d date := p_from; dr jsonb; v_leave numeric; v_in timestamptz; v_out timestamptz; v_secs int; v_total numeric := 0; v_min int;
begin
  while d <= p_to loop
    dr := private.day_rules(p_emp, d);
    if coalesce((dr->>'working_day')::boolean, false) and coalesce((dr->>'attendance')::boolean, true) then
      select least(1, coalesce(sum(case when lr.duration = 'half' then 0.5 else 1 end), 0)) into v_leave
      from public.leave_requests lr
      where lr.employee_id = p_emp and lr.status = 'approved' and lr.start_date <= d and lr.end_date >= d;
      v_in := null; v_out := null; v_secs := null;
      select x.check_in_at, x.check_out_at, x.working_seconds into v_in, v_out, v_secs
      from public.attendance_effective x where x.employee_id = p_emp and x.date = d and x.check_in_at is not null limit 1;
      if v_in is null then
        v_total := v_total + (1 - v_leave);                                  -- no check-in, no leave
      elsif v_out is not null then
        v_min := coalesce(v_secs, 0) / 60;
        if coalesce((dr->>'absent_below_minutes')::int, 0) > 0 and v_min < (dr->>'absent_below_minutes')::int then
          v_total := v_total + (1 - v_leave);                                -- too short to count
        elsif v_leave = 0 and coalesce((dr->>'half_day_minutes')::int, 0) > 0 and v_min < (dr->>'half_day_minutes')::int then
          v_total := v_total + 0.5;                                          -- half day
        end if;
      end if;                                                                -- open day (no check-out): not deducted
    end if;
    d := d + 1;
  end loop;
  return v_total;
end $$;
revoke all on function private.payroll_absent_days(uuid, date, date) from public, anon, authenticated;

create or replace function private.generate_payroll_internal(p_month date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p date := date_trunc('month',p_month)::date;
  next_p date := (p + interval '1 month')::date;
  v_period_id uuid;
  emp record;
  salary numeric;
  ledger public.leave_ledger%rowtype;
  v_divisor integer;
  daily_rate numeric;
  unpaid numeric;
  deduction numeric;
  absent numeric;
  absent_ded numeric;
  final_pay numeric;
  working_days integer;
  eligible_days integer;
  d date;
  is_working boolean;
  v_divisor_mode text;
  v_absent_from date;
  v_end date;
  v_eng date;
begin
  perform private.ensure_leave_ledgers((next_p - 1)::date);
  select s.divisor_mode, s.absent_from into v_divisor_mode, v_absent_from from public.payroll_settings s where s.id=true;

  if v_divisor_mode='working_days' then
    working_days:=0;
    d:=p;
    while d<next_p loop
      is_working := extract(dow from d)<>0 and not exists(select 1 from public.holidays h where h.date=d);
      if is_working then working_days:=working_days+1; end if;
      d:=d+1;
    end loop;
    v_divisor:=greatest(1,working_days);
  else
    v_divisor:=extract(day from (next_p - interval '1 day'))::integer;
  end if;

  select pp.id into v_period_id from public.payroll_periods pp where pp.month_start=p;
  if v_period_id is null then
    insert into public.payroll_periods(month_start,divisor_mode,day_divisor,status)
    values(p,v_divisor_mode,v_divisor,'draft') returning id into v_period_id;
  elsif exists(select 1 from public.payroll_periods pp where pp.id=v_period_id and pp.status='finalized') then
    raise exception 'Payroll period is finalized';
  else
    update public.payroll_periods set divisor_mode=v_divisor_mode, day_divisor=v_divisor, updated_at=now() where id=v_period_id;
  end if;

  for emp in
    select e.* from public.employees e
    where e.join_date < next_p
      and (
        e.status='active'
        or exists(select 1 from public.salary_history sh0 where sh0.employee_id=e.id and sh0.effective_from < next_p
                  and (sh0.effective_to is null or sh0.effective_to >= p))
        or exists(select 1 from public.payroll_records pr0 join public.payroll_periods pp0 on pp0.id=pr0.period_id
                  where pr0.employee_id=e.id and pp0.month_start=p)
      )
    order by e.name
  loop
    select sh.monthly_salary into salary from public.salary_history sh
    where sh.employee_id=emp.id and sh.effective_from<next_p and (sh.effective_to is null or sh.effective_to>=p)
    order by sh.effective_from desc limit 1;
    salary:=coalesce(salary,0);

    select * into ledger from public.leave_ledger l where l.employee_id=emp.id and l.period_start=p;
    unpaid:=coalesce(ledger.unpaid_used,0);

    -- F5: pay stops after the engagement end set in "How they work"
    v_eng := (private.work_rules_on(emp.id, (next_p - 1))).engagement_end;
    v_end := case when v_eng is not null and v_eng < next_p then v_eng + 1 else next_p end;

    if v_divisor_mode='working_days' then
      eligible_days:=0;
      d:=greatest(p,emp.join_date);
      while d<v_end loop
        is_working := extract(dow from d)<>0 and not exists(select 1 from public.holidays h where h.date=d);
        if is_working then eligible_days:=eligible_days+1; end if;
        d:=d+1;
      end loop;
    else
      eligible_days:=greatest(0,(v_end-greatest(p,emp.join_date)));
    end if;

    daily_rate:=case when v_divisor>0 then salary/v_divisor else 0 end;
    deduction:=round(unpaid*daily_rate,2);

    -- F4: working days with no check-in and no leave (and short days) up to yesterday
    absent := 0;
    if salary > 0 then
      absent := private.payroll_absent_days(emp.id,
                  greatest(p, emp.join_date, coalesce(v_absent_from, p)),
                  least(v_end - 1, private.today_ist() - 1));
    end if;
    absent_ded := round(absent*daily_rate,2);

    final_pay:=greatest(0, round((salary*least(v_divisor,eligible_days)/v_divisor)-deduction-absent_ded,2));

    insert into public.payroll_records(period_id,employee_id,salary_snapshot,paid_leave_days,
      unpaid_leave_days,daily_rate,leave_deduction,absent_days,absent_deduction,final_pay)
    values(v_period_id,emp.id,salary,coalesce(ledger.paid_used,0),unpaid,daily_rate,deduction,absent,absent_ded,final_pay)
    on conflict(period_id,employee_id) do update
    set salary_snapshot=excluded.salary_snapshot,
        paid_leave_days=excluded.paid_leave_days,
        unpaid_leave_days=excluded.unpaid_leave_days,
        daily_rate=excluded.daily_rate,
        leave_deduction=excluded.leave_deduction,
        absent_days=excluded.absent_days,
        absent_deduction=excluded.absent_deduction,
        final_pay=excluded.final_pay,
        updated_at=now();
  end loop;

  return v_period_id;
end;
$$;
