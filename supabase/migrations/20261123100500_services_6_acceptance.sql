-- Services module, part 6: the client's acceptance of a quotation is recorded as a contract acceptance
-- (who, when, IP, browser, wording), so the project opens in the client portal exactly like a signed contract.
alter table public.service_quotes add column if not exists accepted_ip text, add column if not exists accepted_user_agent text;

do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('private.service_quote_frozen()'::regprocedure);
  n := replace(d, $a$array['status','responded_at','responded_by','client_note','updated_at']$a$,
                  $a$array['status','responded_at','responded_by','client_note','updated_at','accepted_ip','accepted_user_agent']$a$);
  if n = d and position('accepted_ip' in d) = 0 then raise exception 'frozen: anchor not found'; end if;
  execute n;

  d := pg_get_functiondef('public.client_service_quote_respond(uuid,text,text)'::regprocedure);
  if position('accepted_ip' in d) = 0 then
    n := replace(d, $a$update public.service_quotes set status = 'accepted', responded_at = now(), responded_by = auth.uid(), client_note = v_note where id = q.id;$a$,
      $a$update public.service_quotes set status = 'accepted', responded_at = now(), responded_by = auth.uid(), client_note = v_note,
        accepted_ip = left(private.request_ip()::text, 64),
        accepted_user_agent = left(nullif(current_setting('request.headers', true), '')::json->>'user-agent', 400) where id = q.id;$a$);
    if n = d then raise exception 'respond: anchor not found'; end if;
    execute n;
  end if;

  d := pg_get_functiondef('public.staff_service_start(uuid,uuid,text,boolean,text)'::regprocedure);
  if position('contract_acceptances' in d) = 0 then
    n := replace(d, $a$  returning id into v_contract;
$a$, $a$  returning id into v_contract;
  insert into public.contract_acceptances (contract_id, project_id, version, url, who, event, note, user_id, client_id,
    version_no, ip_address, user_agent, acknowledgement)
  values (v_contract, v_project, 'v1', '', coalesce((select full_name from public.client_users where profile_id = q.responded_by), 'Client user'),
    'Accepted', 'Accepted quotation ' || r.request_no || ' v' || q.version_no || coalesce(': ' || q.client_note, ''),
    q.responded_by, r.client_id, 1, q.accepted_ip, q.accepted_user_agent,
    'Accepted quotation ' || r.request_no || ' v' || q.version_no || ' (₹' || to_char(q.grand_total, 'FM99,99,99,990.00') || ' incl. GST) in the client portal.');
$a$);
    if n = d then raise exception 'start: anchor not found'; end if;
    execute n;
  end if;
end $mig$;
