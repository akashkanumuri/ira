-- SIGMA 1 — Scope of work on the contract. Additive only.
-- Each scope row is a deliverable in Draft attached to the contract. Sending the contract freezes a copy
-- of the rows into that contract version (what the client sees and signs); accepting it activates them
-- (client_accept_contract already turns the contract's Draft deliverables into Pending).

alter table public.deliverables add column if not exists handover text[] not null default '{}';
alter table public.contract_versions add column if not exists scope jsonb;

-- The scope rows the contract will carry.
create or replace function private.contract_scope_rows(p_contract_id uuid)
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'no', d.deliverable_number, 'task', d.name, 'scope', d.description, 'handover', to_jsonb(d.handover),
           'quantity', d.quantity, 'unit', d.unit, 'timeline', d.timeline, 'drafts', d.included_drafts)
         order by d.sort_order, d.deliverable_number), '[]'::jsonb)
    from public.deliverables d join public.contracts k on k.id = p_contract_id
   where d.project_id = k.project_id and d.status = 'Draft' and d.deleted_at is null
     and (d.contract_id is null or d.contract_id = k.id)
$function$;

-- Save the whole scope table in one go while the contract is still a draft (or was declined).
-- p_rows: [{id?, task, scope, handover:[...], quantity, unit, timeline, drafts}] in display order.
create or replace function public.staff_scope_save(p_contract_id uuid, p_rows jsonb)
 returns int language plpgsql security definer set search_path to ''
as $function$
declare k public.contracts; r jsonb; i int := 0; v_id uuid; v_keep uuid[] := '{}'; v_next int;
begin
  select * into k from public.contracts where id = p_contract_id and deleted_at is null for update;
  perform private.require(found, 'Contract not found');
  perform private.require(private.has_permission('contract.create'), 'You are not allowed to edit contracts');
  perform private.require(k.status in ('Draft','Declined'), 'The scope is locked while the client reviews the contract. Create a revised version to change it.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) <= 200, 'Invalid scope');

  select coalesce(max(nullif(regexp_replace(deliverable_number, '\D', '', 'g'), '')::int), 0) into v_next
    from public.deliverables where project_id = k.project_id;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    perform private.require(length(btrim(coalesce(r->>'task', ''))) between 2 and 200, format('Row %s: give the task a name', i));
    perform private.require(length(coalesce(r->>'scope', '')) <= 5000, format('Row %s: scope is too long', i));
    perform private.require(coalesce((r->>'quantity')::numeric, 1) >= 0, format('Row %s: quantity cannot be negative', i));
    perform private.require(coalesce((r->>'drafts')::int, 3) between 0 and 20, format('Row %s: drafts must be 0 to 20', i));
    v_id := nullif(r->>'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.deliverables d where d.id = v_id and d.project_id = k.project_id
                                     and d.status = 'Draft' and d.deleted_at is null) then
      update public.deliverables set
        name = btrim(r->>'task'), description = nullif(btrim(coalesce(r->>'scope', '')), ''),
        handover = coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(coalesce(r->'handover', '[]'::jsonb)) x where btrim(x) <> ''), '{}'),
        quantity = coalesce((r->>'quantity')::numeric, 1), unit = nullif(btrim(coalesce(r->>'unit', '')), ''),
        timeline = nullif(btrim(coalesce(r->>'timeline', '')), ''), included_drafts = coalesce((r->>'drafts')::int, 3),
        sort_order = i, contract_id = k.id, updated_at = now()
      where id = v_id;
    else
      v_next := v_next + 1;
      insert into public.deliverables (project_id, contract_id, deliverable_number, name, description, handover, quantity, unit,
                                       timeline, included_drafts, sort_order, status, reference_url, dependencies)
      values (k.project_id, k.id, 'D-' || lpad(v_next::text, 3, '0'), btrim(r->>'task'), nullif(btrim(coalesce(r->>'scope', '')), ''),
              coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(coalesce(r->'handover', '[]'::jsonb)) x where btrim(x) <> ''), '{}'),
              coalesce((r->>'quantity')::numeric, 1), nullif(btrim(coalesce(r->>'unit', '')), ''),
              nullif(btrim(coalesce(r->>'timeline', '')), ''), coalesce((r->>'drafts')::int, 3), i, 'Draft', '—', '—')
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  -- Rows taken out of the table: soft-deleted (they were never sent or signed).
  update public.deliverables set deleted_at = now(), updated_at = now()
   where project_id = k.project_id and status = 'Draft' and deleted_at is null
     and (contract_id is null or contract_id = k.id) and not (id = any(v_keep));
  return i;
end $function$;
revoke all on function public.staff_scope_save(uuid, jsonb) from public, anon;
grant execute on function public.staff_scope_save(uuid, jsonb) to authenticated;

-- While the client is reviewing a sent contract its scope rows cannot change.
create or replace function private.contract_scope_lock()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare v_row public.deliverables; v_status text;
begin
  v_row := case when TG_OP = 'DELETE' then OLD else NEW end;
  if v_row.status <> 'Draft' and (TG_OP <> 'UPDATE' or OLD.status <> 'Draft') then return v_row; end if;
  select k.status into v_status from public.contracts k
   where k.deleted_at is null and k.id = coalesce(v_row.contract_id,
         (select k2.id from public.contracts k2 where k2.project_id = v_row.project_id and k2.deleted_at is null order by k2.created_at desc limit 1));
  if v_status in ('Sent','Viewed','Awaiting Acceptance') then
    raise exception 'The scope is locked while the client reviews the contract. Create a revised version to change it.';
  end if;
  return v_row;
end $function$;
drop trigger if exists contract_scope_lock on public.deliverables;
create trigger contract_scope_lock before insert or update or delete on public.deliverables
  for each row execute function private.contract_scope_lock();

-- Sending needs a scope, and freezes it into the version being sent.
do $$
declare d text;
begin
  select pg_get_functiondef('public.staff_send_contract(uuid)'::regprocedure) into d;
  if position('contract_scope_rows' in d) = 0 then
    d := replace(d, '  update public.contracts set status = ''Sent''',
      '  perform private.require(jsonb_array_length(private.contract_scope_rows(k.id)) > 0, ''Add the scope of work (at least one task) before sending'');
  update public.contract_versions set scope = private.contract_scope_rows(k.id)
   where contract_id = k.id and version_no = k.current_version_no;
  update public.contracts set status = ''Sent''');
    execute d;
  end if;
end $$;
