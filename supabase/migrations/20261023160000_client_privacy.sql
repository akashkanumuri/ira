-- SIGMA 1 — clients never see who on the IRA side did the work.
--
-- Deliverables and modification requests are readable by the client (RLS). They used to carry
-- staff names in plain text (responsible_name, reviewer_name). Identity stays in the uuid
-- columns (responsible_id, reviewed_by), which clients cannot resolve; staff screens look the
-- name up from the employee list instead. Additive: no rows or columns removed.

set local lock_timeout = '5s';

create or replace function private.deliverables_default_number()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if new.deliverable_number is null or btrim(new.deliverable_number) = '' then
    perform pg_advisory_xact_lock(hashtext('deliv-num:' || new.project_id::text));
    select count(*) + 1 into n from public.deliverables where project_id = new.project_id;
    new.deliverable_number := 'D-' || lpad(n::text, 3, '0');
  end if;
  if new.created_by is null then new.created_by := auth.uid(); end if;
  new.responsible_name := null;  -- client-visible row: keep only the id
  return new;
end $$;

create or replace function private.change_request_hide_reviewer()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reviewer_name is not null then new.reviewer_name := 'IRA team'; end if;
  return new;
end $$;
create or replace trigger trg_change_requests_hide_reviewer before insert or update of reviewer_name on public.change_requests
  for each row execute function private.change_request_hide_reviewer();
revoke execute on function private.change_request_hide_reviewer() from public, anon, authenticated;

-- Existing rows: clear the cached names (ids are kept).
update public.deliverables set responsible_name = null where responsible_name is not null;
update public.change_requests set reviewer_name = 'IRA team' where reviewer_name is not null and reviewer_name <> 'IRA team';
