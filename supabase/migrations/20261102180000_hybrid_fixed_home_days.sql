-- Hybrid with fixed office days (Keka-style): the admin picks the office days, every other working day is a home day.
-- A planned home day is always WFH-ok — a swapped (approved) home day earlier in the week must not use it up.
-- Hybrid without fixed days (older "any N days" setups) keeps the quota behaviour.
create or replace function private.wfh_refusal(p_employee_id uuid, p_date date, p_dr jsonb)
 returns text language plpgsql stable security definer set search_path to ''
as $function$
declare v_extra text; r public.employee_work_rules%rowtype; h jsonb; v_pending boolean;
begin
  if p_dr->>'location' = 'home' then return null; end if;
  if exists (select 1 from public.wfh_requests w where w.employee_id = p_employee_id and w.date = p_date and w.status = 'approved') then return null; end if;
  r := private.work_rules_on(p_employee_id, p_date);
  v_extra := coalesce(r.extra_wfh, 'approval');
  if p_dr->>'location' = 'either' then
    if r.location_mode = 'hybrid' and r.office_days_period = 'week'
       and cardinality(r.must_come_days) > 0 and cardinality(r.must_come_days) >= coalesce(r.office_days_count, 0) then
      return null;  -- a planned home day
    end if;
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
end $function$;
