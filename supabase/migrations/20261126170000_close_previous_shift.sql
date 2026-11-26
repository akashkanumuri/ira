-- "Close previous shift" for a day the employee forgot to check out (also when they left it on a break).
-- The shift is closed at the end of that day's shift (or midnight if they checked in after the shift ended),
-- never at "now" — otherwise days of absence would be counted as working time. Any open break ends at the same time.
-- The record is marked so a manager can see it, and the employee can ask for a correction if they worked longer.

create or replace function public.close_previous_shift(p_attendance uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.attendance; dr jsonb; sh jsonb; v_target timestamptz; v_break int; v_work int; v_claims text;
  v_emp uuid := private.current_employee_id(); v_today date := private.today_ist();
begin
  perform private.require(v_emp is not null and not private.offer_locked(), 'Only employees can close their shifts');
  select * into a from public.attendance where id = p_attendance for update;
  perform private.require(found and a.employee_id = v_emp, 'Shift not found');
  perform private.require(a.check_out_at is null and a.current_state <> 'completed' and a.check_in_at is not null, 'This shift is already closed');
  perform private.require(a.date < v_today, 'Today''s shift is closed with the normal Check out button');

  dr := private.day_rules(a.employee_id, a.date);
  sh := coalesce(nullif(dr -> 'shift2', 'null'::jsonb), nullif(dr -> 'shift', 'null'::jsonb));
  if sh is not null and sh ->> 'end' is not null then
    v_target := ((a.date + case when coalesce((sh ->> 'overnight')::boolean, false) then 1 else 0 end) + (sh ->> 'end')::time) at time zone 'Asia/Kolkata';
  end if;
  if v_target is null or v_target <= a.check_in_at then
    v_target := ((a.date + 1)::timestamp at time zone 'Asia/Kolkata') - interval '1 second';
  end if;
  v_target := least(v_target, now());

  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.break_events set break_end = greatest(break_start, v_target) where attendance_id = a.id and break_end is null;
  select coalesce(sum(duration_seconds), 0) into v_break from public.break_events where attendance_id = a.id;
  v_work := greatest(0, floor(extract(epoch from (v_target - a.check_in_at)))::integer - v_break);
  update public.attendance set check_out_at = v_target, current_state = 'completed', total_break_seconds = v_break, working_seconds = v_work,
    notes = concat_ws(' · ', nullif(notes, ''), 'Closed the next day by the employee (forgot to check out)')
  where id = a.id;
  insert into public.attendance_events (attendance_id, event_type, event_at, user_agent, metadata)
  values (a.id, 'check_out', v_target, 'system', jsonb_build_object('closed_late_by_employee', true, 'closed_at', now()));
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  perform private.audit('attendance', a.id::text, 'close_previous_shift',
    jsonb_build_object('date', a.date, 'check_out_at', v_target, 'working_seconds', v_work), null, null, null, '{}'::jsonb);
  return jsonb_build_object('check_out_at', v_target, 'working_seconds', v_work, 'break_seconds', v_break);
end $$;
revoke all on function public.close_previous_shift(uuid) from public, anon;
grant execute on function public.close_previous_shift(uuid) to authenticated;
