-- SIGMA 1 — "Tap to open" opens the item itself, not just its section.
-- Every notification already carries the record it is about in its idempotency key
-- (task_review_<task id>_…, dcomment_<comment id>, client_review_<round id>, …). A BEFORE INSERT
-- trigger reads that, finds the task or deliverable, and points action_url at it. Notifications
-- that already link to a specific item, or that this cannot place, are left exactly as they were.
-- It never blocks a notification: any error leaves the original link.

create or replace function private.notification_deep_link()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  k text := coalesce(NEW.idempotency_key, '');
  u text := coalesce(NEW.action_url, '');
  v_id uuid;
  v_task uuid;
  v_deliv uuid;
  v_round int;
  v_role text;
  v_path text;
begin
  if u = '' or position('?' in u) > 0 then return NEW; end if;  -- already specific, or nothing to open
  begin
    v_id := (regexp_match(k, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'))[1]::uuid;
    if v_id is null then return NEW; end if;

    -- What the key is about.
    if k ~ '^task_comment_' then
      select task_id into v_task from public.task_comments where id = v_id;
    elsif k ~ '^(ask|check)_' then
      select task_id into v_task from public.progress_checks where id = v_id;
    elsif k ~ '^task_' then
      v_task := v_id;
    elsif k ~ '^deliv-(status|assign):' then
      v_deliv := v_id;
    elsif k ~ '^dcomment_' then
      select deliverable_id into v_deliv from public.deliverable_comments where id = v_id;
    elsif k ~ '^(client_review_|client_decision_)' then
      select deliverable_id, round_no into v_deliv, v_round from public.deliverable_client_reviews where id = v_id;
    elsif k ~ '^dep-(new|up|up-staff|review):' then
      select deliverable_id into v_deliv from public.deliverable_dependencies where id = v_id;
    elsif k ~ '^cr-(new|new-emp|decision|approved-emp):' then
      select deliverable_id into v_deliv from public.change_requests where id = v_id;
    else
      return NEW;
    end if;

    if v_task is not null and u in ('/emp-tasks', '/admin-tasks') then
      NEW.action_url := u || '?task=' || v_task;
      return NEW;
    end if;

    if v_deliv is not null then
      select role into v_role from public.profiles where id = NEW.recipient_id;
      v_path := case
        when v_role = 'client' then '/client/deliverables'
        when v_role = 'admin' then '/admin-delivery'
        else '/emp-delivery' end;
      NEW.action_url := v_path || '?deliverable=' || v_deliv || coalesce('&round=' || v_round, '');
    end if;
  exception when others then
    NEW.action_url := u;  -- leave it as it was
  end;
  return NEW;
end $function$;

drop trigger if exists notification_deep_link on public.notifications;
create trigger notification_deep_link before insert on public.notifications
  for each row execute function private.notification_deep_link();
