-- Client flow dry run: contract → milestone → invoice → payment → verify, deliverable review round,
-- dependency, modification request, support, and isolation from another client. Everything is rolled back.
create temp table _r(n serial, step text, ok boolean, info text);
create temp table _ids(k text primary key, v text);
grant all on _r, _ids to public; grant usage on sequence _r_n_seq to public;
insert into _ids values ('admin','637fe755-6dae-47f1-a1b8-a70b7217cc79'),('jk','58a91a8d-e516-41b6-8bdc-0d0be18d7cb2'),
  ('ncc','c799d76b-d853-4102-8f7f-ea4cf3f74e76'),('proj','f388d7a6-e638-4e62-a421-72ed809c4bf1');
insert into _ids select 'del', id::text from deliverables where project_id='f388d7a6-e638-4e62-a421-72ed809c4bf1' and deleted_at is null limit 1;

-- ── admin: create + send contract
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select v from _ids where k='admin'),'role','authenticated')::text, true), set_config('request.jwt.claim.sub',(select v from _ids where k='admin'),true);
do $$ declare x uuid; begin
  x := staff_create_contract((select v from _ids where k='proj')::uuid, 'Dry-run retainer', 'DR-001', 'https://example.com/contract.pdf', null, 120000, '18% GST extra', current_date, current_date + 180, null, 'Monthly social media retainer');
  insert into _ids values ('contract', x::text); insert into _r(step,ok,info) values ('staff_create_contract', true, x::text);
exception when others then insert into _r(step,ok,info) values ('staff_create_contract', false, sqlerrm); end $$;
do $$ begin perform staff_send_contract((select v from _ids where k='contract')::uuid); insert into _r(step,ok,info) select 'staff_send_contract', true, status::text from contracts where id=(select v from _ids where k='contract')::uuid;
exception when others then insert into _r(step,ok,info) values ('staff_send_contract', false, sqlerrm); end $$;

-- ── other client must not see it
select set_config('request.jwt.claims', json_build_object('sub',(select v from _ids where k='ncc'),'role','authenticated')::text, true), set_config('request.jwt.claim.sub',(select v from _ids where k='ncc'),true);
do $$ declare c int; begin select count(*) into c from contracts where id=(select v from _ids where k='contract')::uuid; insert into _r(step,ok,info) values ('isolation: other client sees contract', c=0, c::text);
  begin perform client_accept_contract((select v from _ids where k='contract')::uuid, 1, true, 'dry'); insert into _r(step,ok,info) values ('isolation: other client accept blocked', false, 'accepted!');
  exception when others then insert into _r(step,ok,info) values ('isolation: other client accept blocked', true, sqlerrm); end;
  select count(*) into c from projects where id=(select v from _ids where k='proj')::uuid; insert into _r(step,ok,info) values ('isolation: other client sees project', c=0, c::text);
end $$;

-- ── jk: view + accept
select set_config('request.jwt.claims', json_build_object('sub',(select v from _ids where k='jk'),'role','authenticated')::text, true), set_config('request.jwt.claim.sub',(select v from _ids where k='jk'),true);
do $$ declare c record; begin
  select * into c from contracts where id=(select v from _ids where k='contract')::uuid;
  insert into _r(step,ok,info) values ('client sees contract', c.id is not null, coalesce(c.status::text,'none')||' v'||coalesce(c.current_version_no::text,'?'));
  perform client_mark_contract_viewed(c.id); insert into _r(step,ok,info) values ('client_mark_contract_viewed', true, '');
  perform client_accept_contract(c.id, c.current_version_no, true, 'dry-run agent');
  insert into _r(step,ok,info) select 'client_accept_contract', true, status::text from contracts where id=c.id;
exception when others then insert into _r(step,ok,info) values ('client view/accept', false, sqlerrm); end $$;

-- ── admin: milestone + invoice
select set_config('request.jwt.claims', json_build_object('sub',(select v from _ids where k='admin'),'role','authenticated')::text, true), set_config('request.jwt.claim.sub',(select v from _ids where k='admin'),true);
do $$ declare x uuid; begin
  insert into payment_installments(project_id, contract_id, name, basis_type, amount, basis, tax_amount, due_date, status)
  values ((select v from _ids where k='proj')::uuid, (select v from _ids where k='contract')::uuid, 'Month 1', 'fixed', 10000, 'Fixed amount', 1800, current_date + 7, 'Upcoming') returning id into x;
  insert into _ids values ('inst', x::text); insert into _r(step,ok,info) select 'add milestone', true, 'no '||installment_number||' status '||status from payment_installments where id=x;
exception when others then insert into _r(step,ok,info) values ('add milestone', false, sqlerrm); end $$;
do $$ begin perform finance_issue_invoice((select v from _ids where k='inst')::uuid);
  insert into _r(step,ok,info) select 'finance_issue_invoice', invoice_number is not null, coalesce(invoice_number,'null') from payment_installments where id=(select v from _ids where k='inst')::uuid;
exception when others then insert into _r(step,ok,info) values ('finance_issue_invoice', false, sqlerrm); end $$;

-- ── jk: pay (twice with the same key → one payment)
select set_config('request.jwt.claims', json_build_object('sub',(select v from _ids where k='jk'),'role','authenticated')::text, true), set_config('request.jwt.claim.sub',(select v from _ids where k='jk'),true);
do $$ declare c int; begin
  select count(*) into c from payment_installments where id=(select v from _ids where k='inst')::uuid; insert into _r(step,ok,info) values ('client sees milestone', c=1, c::text);
  perform client_submit_payment((select v from _ids where k='inst')::uuid, 11800, 'UTR-DRY-1', current_date, 'bank_transfer', null, 'dry-key-1');
  perform client_submit_payment((select v from _ids where k='inst')::uuid, 11800, 'UTR-DRY-1', current_date, 'bank_transfer', null, 'dry-key-1');
  select count(*) into c from payments where installment_id=(select v from _ids where k='inst')::uuid;
  insert into _r(step,ok,info) values ('client_submit_payment (idempotent)', c=1, c::text||' payment row(s)');
exception when others then insert into _r(step,ok,info) values ('client_submit_payment', false, sqlerrm); end $$;
do $$ begin insert into _ids select 'pay', id::text from payments where installment_id=(select v from _ids where k='inst')::uuid limit 1; end $$;

-- ── admin: verify
select set_config('request.jwt.claims', json_build_object('sub',(select v from _ids where k='admin'),'role','authenticated')::text, true), set_config('request.jwt.claim.sub',(select v from _ids where k='admin'),true);
do $$ begin perform finance_verify_payment((select v from _ids where k='pay')::uuid, true, null);
  insert into _r(step,ok,info) select 'finance_verify_payment', i.status='Paid', 'inst '||i.status||' paid '||i.amount_paid||' / pay '||p.status from payment_installments i, payments p where i.id=(select v from _ids where k='inst')::uuid and p.id=(select v from _ids where k='pay')::uuid;
exception when others then insert into _r(step,ok,info) values ('finance_verify_payment', false, sqlerrm); end $$;

-- ── deliverable review round
do $$ declare x uuid; begin
  x := staff_send_to_client((select v from _ids where k='del')::uuid, 'https://example.com/drafts/v1', 'First draft for review', null);
  insert into _ids values ('review', x::text); insert into _r(step,ok,info) values ('staff_send_to_client', true, x::text);
exception when others then insert into _r(step,ok,info) values ('staff_send_to_client', false, sqlerrm); end $$;
do $$ declare x uuid; begin
  x := staff_request_dependency((select v from _ids where k='del')::uuid, 'Brand logo files', 'Vector logo + fonts', current_date + 3);
  insert into _ids values ('dep', x::text); insert into _r(step,ok,info) values ('staff_request_dependency', true, x::text);
exception when others then insert into _r(step,ok,info) values ('staff_request_dependency', false, sqlerrm); end $$;

select set_config('request.jwt.claims', json_build_object('sub',(select v from _ids where k='jk'),'role','authenticated')::text, true), set_config('request.jwt.claim.sub',(select v from _ids where k='jk'),true);
do $$ declare c int; begin
  select count(*) into c from client_deliverable_reviews((select v from _ids where k='del')::uuid); insert into _r(step,ok,info) values ('client sees review rounds', c>=1, c::text);
  perform client_decide_review((select v from _ids where k='review')::uuid, false, 'Please change the colours');
  insert into _r(step,ok,info) select 'client_decide_review (changes)', true, coalesce((select r->>'status' from jsonb_array_elements(to_jsonb(array(select to_jsonb(t) from client_deliverable_reviews((select v from _ids where k='del')::uuid) t))) r where r->>'id'=(select v from _ids where k='review') limit 1),'?');
exception when others then insert into _r(step,ok,info) values ('client_decide_review', false, sqlerrm); end $$;
do $$ begin perform client_submit_dependency((select v from _ids where k='dep')::uuid, 'Uploaded to drive: https://example.com/logo', '{}'::uuid[]);
  insert into _r(step,ok,info) select 'client_submit_dependency', true, status from deliverable_dependencies where id=(select v from _ids where k='dep')::uuid;
exception when others then insert into _r(step,ok,info) values ('client_submit_dependency', false, sqlerrm); end $$;
do $$ declare x uuid; begin
  select client_request_modification((select v from _ids where k='del')::uuid, 'timeline', 'Need two more weeks', null, current_date + 30, null, 'dry-mod-1') into x;
  insert into _ids values ('mod', x::text); insert into _r(step,ok,info) values ('client_request_modification', true, coalesce(x::text,'null'));
exception when others then insert into _r(step,ok,info) values ('client_request_modification', false, sqlerrm); end $$;
do $$ declare x uuid; begin
  select support_create('Dry-run question', 'Where do I see invoices?', 'billing', (select v from _ids where k='proj')::uuid) into x;
  insert into _ids values ('sup', x::text); insert into _r(step,ok,info) values ('support_create', true, coalesce(x::text,'null'));
exception when others then insert into _r(step,ok,info) values ('support_create', false, sqlerrm); end $$;
do $$ declare c int; begin select count(*) into c from notifications where recipient_id=(select v from _ids where k='jk')::uuid and created_at > now() - interval '1 minute';
  insert into _r(step,ok,info) values ('client notifications created', c>0, c::text);
exception when others then insert into _r(step,ok,info) values ('client notifications', false, sqlerrm); end $$;

select set_config('request.jwt.claims', json_build_object('sub',(select v from _ids where k='admin'),'role','authenticated')::text, true), set_config('request.jwt.claim.sub',(select v from _ids where k='admin'),true);
do $$ begin perform staff_forward_client_feedback((select v from _ids where k='review')::uuid, 'Client wants new colours', (select id from tasks where deliverable_id=(select v from _ids where k='del')::uuid limit 1));
  insert into _r(step,ok,info) select 'staff_forward_client_feedback', true, status from deliverable_client_reviews where id=(select v from _ids where k='review')::uuid;
exception when others then insert into _r(step,ok,info) values ('staff_forward_client_feedback', false, sqlerrm); end $$;
do $$ begin perform staff_review_dependency((select v from _ids where k='dep')::uuid, 'accept', 'Got it');
  insert into _r(step,ok,info) select 'staff_review_dependency', true, status from deliverable_dependencies where id=(select v from _ids where k='dep')::uuid;
exception when others then insert into _r(step,ok,info) values ('staff_review_dependency', false, sqlerrm); end $$;
do $$ begin perform staff_review_modification((select v from _ids where k='mod')::uuid, 'approve', 'OK', null, null, null, null);
  insert into _r(step,ok,info) values ('staff_review_modification', true, '');
exception when others then insert into _r(step,ok,info) values ('staff_review_modification', false, sqlerrm); end $$;
do $$ begin perform support_reply((select v from _ids where k='sup')::uuid, 'Invoices are under Payments.', false);
  insert into _r(step,ok,info) values ('support_reply', true, '');
exception when others then insert into _r(step,ok,info) values ('support_reply', false, sqlerrm); end $$;

-- ── other client must not see payments/support/reviews
select set_config('request.jwt.claims', json_build_object('sub',(select v from _ids where k='ncc'),'role','authenticated')::text, true), set_config('request.jwt.claim.sub',(select v from _ids where k='ncc'),true);
do $$ declare a int; b int; c int; d int; begin
  select count(*) into a from payments where id=(select v from _ids where k='pay')::uuid;
  select count(*) into b from support_requests where id=(select v from _ids where k='sup')::uuid;
  select count(*) into c from deliverable_client_reviews where id=(select v from _ids where k='review')::uuid;
  select count(*) into d from payment_installments where id=(select v from _ids where k='inst')::uuid;
  insert into _r(step,ok,info) values ('isolation: payments/support/reviews/milestones', a+b+c+d=0, a||'/'||b||'/'||c||'/'||d);
end $$;

reset role;
do $$ begin raise exception 'RESULTS %', (select string_agg(n||'. '||case when ok then 'PASS ' else 'FAIL ' end||step||' — '||coalesce(info,''), E'\n' order by n) from _r); end $$;
