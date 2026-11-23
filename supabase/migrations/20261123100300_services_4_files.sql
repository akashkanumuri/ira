-- Services module, part 4: attachments on service requests (client brief files, staff reference files).
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.attach_file(text,text,uuid,text,text,bigint,text,boolean,uuid)'::regprocedure);
  if position('service_request' in d) = 0 then
    n := replace(d, $a$    when 'leave' then$a$, $a$    when 'service_request' then
      select r.project_id, r.client_id into v_project, v_client from public.service_requests r where r.id = p_parent_id;
      v_allowed := not private.offer_locked() and (
        (v_client_user is not null and v_client_user = v_client and private.has_permission('client.dashboard.view')
          and exists (select 1 from public.service_requests r where r.id = p_parent_id
                      and r.status in ('new','under_review','quote_draft','quote_sent','revision_requested')))
        or (v_client_user is null and private.has_permission('service.manage')));
      if v_client_user is not null then p_visibility := 'client'; end if;
      p_is_final := false;
    when 'leave' then$a$);
    if n = d then raise exception 'attach_file: anchor not found'; end if;
    execute n;
  end if;

  d := pg_get_functiondef('private.can_read_file(uuid)'::regprocedure);
  if position('service_request' in d) = 0 then
    n := replace(d, $a$  if f.parent_type in ('payment','invoice') and private.has_permission('payment.record') then return true; end if;$a$,
      $a$  if f.parent_type in ('payment','invoice') and private.has_permission('payment.record') then return true; end if;
  if f.parent_type = 'service_request' and private.current_client_id() is null and (private.has_permission('service.manage')
     or exists (select 1 from public.service_requests r where r.id = f.parent_id and r.assigned_to = v_emp and v_emp is not null)) then return true; end if;$a$);
    n := replace(n, $a$    when 'project', 'client' then$a$, $a$    when 'service_request' then
      return exists (select 1 from public.service_requests r where r.id = f.parent_id and r.client_id = private.current_client_id());
    when 'project', 'client' then$a$);
    if position('service_request' in n) = 0 or (length(n) - length(replace(n, 'service_request', ''))) / 15 < 2 then
      raise exception 'can_read_file: anchor not found';
    end if;
    execute n;
  end if;
end $mig$;
