-- Verifies the activity alert triggers + push queue inside a transaction that is always rolled back.
-- Run after 20261026150000_activity_alerts_push_pipeline.sql is applied. Nothing persists.
begin;
create temp table _r(msg text) on commit drop;

do $$
declare v_emp uuid; v_task uuid; v_ws uuid; v_n int; v_admins int;
begin
  select count(*) into v_admins from public.profiles where role = 'admin';
  select e.id into v_emp from public.employees e where e.status = 'active' and e.profile_id is not null limit 1;
  select t.id into v_task from public.tasks t where t.assigned_to = v_emp limit 1;

  -- formatting helpers
  if private.fmt_duration(45*60) <> '45 min' then insert into _r values ('fmt_duration minutes'); end if;
  if private.fmt_duration(7*3600+32*60) <> '7h 32m' then insert into _r values ('fmt_duration hours'); end if;
  if private.device_label('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36') <> 'Chrome on Windows' then insert into _r values ('device_label chrome/windows'); end if;
  if private.device_label('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15') <> 'Safari on Mac' then insert into _r values ('device_label safari/mac'); end if;
  if private.device_label('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0') <> 'Edge on Windows' then insert into _r values ('device_label edge'); end if;

  -- task timer start → one activity notification per admin, queued for push
  insert into public.work_sessions(employee_id, kind, task_id, started_at) values (v_emp, 'task', v_task, now()) returning id into v_ws;
  select count(*) into v_n from public.notifications where idempotency_key like 'act_ws_' || v_ws || ':%' and type = 'activity'
    and coalesce(metadata->>'push_state','') = '';
  if v_n <> v_admins then insert into _r values ('task start: expected ' || v_admins || ' got ' || v_n); end if;

  -- stop (pause) → "stopped a task"
  update public.work_sessions set ended_at = now() + interval '45 minutes', end_reason = 'pause' where id = v_ws;
  select count(*) into v_n from public.notifications where idempotency_key like 'act_wsend_' || v_ws || ':%' and message like '%45 min · paused%';
  if v_n <> v_admins then insert into _r values ('task stop: expected ' || v_admins || ' got ' || v_n); end if;

  -- preference off → nothing for that admin
  insert into public.notification_preferences(user_id, activity)
    select id, '{"task": false}'::jsonb from public.profiles where role = 'admin'
    on conflict (user_id) do update set activity = excluded.activity;
  insert into public.work_sessions(employee_id, kind, task_id, started_at) values (v_emp, 'task', v_task, now() + interval '2 hours') returning id into v_ws;
  select count(*) into v_n from public.notifications where idempotency_key like 'act_ws_' || v_ws || ':%';
  if v_n <> 0 then insert into _r values ('preference off still notified: ' || v_n); end if;

  -- claim RPC is service-role only
  begin
    set local role authenticated;
    perform public.claim_push_batch(5);
    reset role;
    insert into _r values ('claim_push_batch callable by authenticated');
  exception when others then reset role;
  end;
  begin
    set local role authenticated;
    perform public.push_hook_secret();
    reset role;
    insert into _r values ('push_hook_secret callable by authenticated');
  exception when others then reset role;
  end;
exception when others then
  insert into _r values ('unexpected: ' || sqlerrm);
end $$;

select coalesce(string_agg(msg, ' | '), 'ACTIVITY_TEST_RESULTS failed=0') as result from _r;
rollback;
