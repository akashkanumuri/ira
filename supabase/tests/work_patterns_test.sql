-- Verifies 20261029090000_work_patterns.sql inside a transaction that is always rolled back.
begin;
-- @@MIGRATION@@
create temp table _r(msg text) on commit drop;
create temp table _ok(msg text) on commit drop;
grant all on _r, _ok to authenticated, anon;
do $$
declare
  v_admin uuid; v_emp uuid; v_prof uuid; v_other uuid; v_dr jsonb; v_n int; v_mode text; v_s time; v_e time;
  d_mon date := date '2026-11-02'; d_tue date := date '2026-11-03'; d_sun date := date '2026-11-08';
  d_sat2 date := date '2026-11-14'; d_sat3 date := date '2026-11-21';
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select id, profile_id into v_emp, v_prof from public.employees where status = 'active' and profile_id is not null order by name limit 1;
  select id into v_other from public.employees where id <> v_emp limit 1;

  -- seed: one row per employee, legacy unchanged
  if (select count(distinct employee_id) from public.employee_work_rules) <> (select count(*) from public.employees) then insert into _r values ('seed count'); else insert into _ok values ('seed'); end if;

  -- day rules on default (office, fixed 9-6, Mon-Sat)
  v_dr := private.day_rules(v_emp, d_mon);
  if not (v_dr->>'working_day')::boolean or v_dr->>'location' <> 'office' or v_dr->>'late_after' <> '09:15:00' then insert into _r values ('default mon: ' || v_dr::text); else insert into _ok values ('default'); end if;
  v_dr := private.day_rules(v_emp, d_sun);
  if v_dr->>'off_reason' <> 'weekly_off' then insert into _r values ('sunday: ' || v_dr::text); else insert into _ok values ('sunday'); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  -- hybrid 3/week, must come Monday, flexible, 2nd&4th Saturday off
  perform public.admin_set_work_rules(v_emp, '{"location_mode":"hybrid","office_days_count":3,"must_come_days":[1],"extra_wfh":"free","schedule_type":"flexible","saturday_off":"second_fourth"}'::jsonb, d_mon);
  reset role;
  v_dr := private.day_rules(v_emp, d_mon);
  if v_dr->>'location' <> 'office' or v_dr->'late_after' <> 'null'::jsonb then insert into _r values ('hybrid mon: ' || v_dr::text); else insert into _ok values ('hybrid must-come'); end if;
  v_dr := private.day_rules(v_emp, d_tue);
  if v_dr->>'location' <> 'either' or not (v_dr->'features'->>'wfh')::boolean then insert into _r values ('hybrid tue: ' || v_dr::text); else insert into _ok values ('hybrid either'); end if;
  if private.day_rules(v_emp, d_sat2)->>'off_reason' <> 'saturday_off' then insert into _r values ('2nd sat'); else insert into _ok values ('2nd sat'); end if;
  if (private.day_rules(v_emp, d_sat3)->>'working_day')::boolean is not true then insert into _r values ('3rd sat'); else insert into _ok values ('3rd sat'); end if;
  -- future-dated: today's rules still the seeded office ones
  if (private.work_rules_on(v_emp, (now() at time zone 'Asia/Kolkata')::date)).location_mode is distinct from 'office' then insert into _r values ('dating'); else insert into _ok values ('dating'); end if;

  -- remote from today → legacy column follows
  set local role authenticated;
  perform public.admin_set_work_rules(v_emp, '{"location_mode":"remote","schedule_type":"flexible_core","core_start":"11:00","core_end":"16:00"}'::jsonb, (now() at time zone 'Asia/Kolkata')::date);
  reset role;
  select work_mode, shift_start, shift_end into v_mode, v_s, v_e from public.employees where id = v_emp;
  if v_mode <> 'remote' or v_s <> '11:00' or v_e <> '16:00' then insert into _r values ('legacy sync: ' || v_mode || ' ' || v_s || ' ' || v_e); else insert into _ok values ('legacy sync'); end if;
  if not exists (select 1 from public.audit_logs where entity_type = 'employee_work_rules' and changes->>'employee_id' = v_emp::text) then insert into _r values ('audit'); else insert into _ok values ('audit'); end if;

  -- validation
  set local role authenticated;
  begin perform public.admin_set_work_rules(v_emp, '{"location_mode":"hybrid","office_days_count":7}'::jsonb, d_tue); insert into _r values ('7 office days accepted');
  exception when others then insert into _ok values ('v-office-days'); end;
  begin perform public.admin_set_work_rules(v_emp, '{"full_day_minutes":240,"half_day_minutes":240}'::jsonb, d_tue); insert into _r values ('half>=full accepted');
  exception when others then insert into _ok values ('v-half'); end;
  begin perform public.admin_set_work_rules(v_emp, '{"employment_type":"project_based","schedule_type":"flexible"}'::jsonb, d_tue); insert into _r values ('project-based w/o project accepted');
  exception when others then insert into _ok values ('v-project'); end;
  begin perform public.admin_set_work_rules(v_emp, '{"location_mode":"hybrid","office_days_count":2,"must_come_days":[7]}'::jsonb, d_tue); insert into _r values ('must-come on off day accepted');
  exception when others then insert into _ok values ('v-mustcome'); end;
  -- built-in template can't be deleted
  delete from public.work_rule_templates where is_builtin;
  get diagnostics v_n = row_count;
  if v_n <> 0 then insert into _r values ('builtin deleted'); else insert into _ok values ('builtin locked'); end if;
  reset role;

  -- employee: own rules readable, others not, can't write, no templates
  perform set_config('request.jwt.claims', json_build_object('sub', v_prof, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_prof::text, true);
  set local role authenticated;
  if (select count(*) from public.employee_work_rules where employee_id = v_emp) = 0 then insert into _r values ('employee cannot read own'); else insert into _ok values ('own read'); end if;
  if (select count(*) from public.employee_work_rules where employee_id <> v_emp) <> 0 then insert into _r values ('employee reads others'); else insert into _ok values ('others hidden'); end if;
  if (select count(*) from public.work_rule_templates) <> 0 then insert into _r values ('employee reads templates'); else insert into _ok values ('templates hidden'); end if;
  begin perform public.admin_set_work_rules(v_emp, '{}'::jsonb, d_tue); insert into _r values ('employee wrote rules');
  exception when others then insert into _ok values ('employee write blocked'); end;
  begin perform public.employee_day_rules(v_other, d_mon); insert into _r values ('employee read other day rules');
  exception when others then insert into _ok values ('day rules scoped'); end;
  if (public.employee_day_rules(null, d_mon)->>'location') is null then insert into _r values ('own day rules'); else insert into _ok values ('own day rules'); end if;
  reset role;
exception when others then reset role; insert into _r values ('unexpected: ' || sqlerrm);
end $$;
select coalesce(string_agg(msg, ' | '), 'WORK_PATTERNS_TEST failed=0') || ' · passed: ' || (select string_agg(msg, ',') from _ok) as result from _r;
rollback;
