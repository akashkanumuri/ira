-- SIGMA 1 — employee offer letters. Additive only.
-- Mirrors the client contract: admin writes the offer from a template, sends it with an expiry; the
-- employee sees only the offer until they accept it. Templates and the terms & conditions library are
-- editable in Settings; a sent letter keeps its own copy of the text, so template edits never change it.

-- 1. Tables ------------------------------------------------------------------------------------------
create table if not exists public.offer_clauses (
  code text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  title text not null check (length(title) between 2 and 120),
  body text not null check (length(body) between 5 and 4000),
  sort int not null default 100,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.offer_templates (
  code text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (length(name) between 2 and 80),
  employment_type text not null check (employment_type in ('full_time','wfh','hybrid','part_time','intern')),
  body text not null check (length(body) between 20 and 30000),
  clause_codes text[] not null default '{}',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.offer_letters (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  template_code text references public.offer_templates(code),
  version_no int not null default 1,
  status text not null default 'Draft' check (status in ('Draft','Sent','Accepted','Declined','Withdrawn')),
  title text not null default 'Offer of employment' check (length(title) between 2 and 160),
  body text not null default '' check (length(body) <= 30000),
  clauses jsonb not null default '[]'::jsonb,
  fields jsonb not null default '{}'::jsonb,
  expires_on date,
  sent_at timestamptz, accepted_at timestamptz, signer_name text,
  declined_at timestamptz, decline_reason text check (decline_reason is null or length(decline_reason) <= 1000),
  withdrawn_at timestamptz,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists offer_letters_one_open on public.offer_letters (employee_id) where status in ('Draft','Sent');
create index if not exists offer_letters_employee on public.offer_letters (employee_id, created_at desc);

alter table public.offer_clauses enable row level security;
alter table public.offer_templates enable row level security;
alter table public.offer_letters enable row level security;

create policy offer_clauses_admin_read on public.offer_clauses for select to authenticated using (private.is_admin());
create policy offer_templates_admin_read on public.offer_templates for select to authenticated using (private.is_admin());
create policy offer_letters_read on public.offer_letters for select to authenticated using (
  private.is_admin() or (employee_id = private.current_employee_id() and status <> 'Draft')
);
grant select on public.offer_clauses, public.offer_templates, public.offer_letters to authenticated;
revoke insert, update on public.offer_clauses, public.offer_templates, public.offer_letters from authenticated, anon;
-- Writes only through the functions below.

-- 2. Functions ---------------------------------------------------------------------------------------
create or replace function private.notify_admins(p_type text, p_title text, p_message text, p_url text, p_key text)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare a record;
begin
  for a in select id from public.profiles where role = 'admin' loop
    perform private.notify(a.id, p_type, p_title, p_message, p_url, p_key || ':' || a.id, '{}'::jsonb);
  end loop;
end $function$;

-- Create or update the employee's offer. A sent or declined offer is revised into a new Draft version.
create or replace function public.offer_save(p_employee_id uuid, p_template_code text, p_title text, p_body text,
  p_clauses jsonb, p_fields jsonb, p_expires_on date)
 returns uuid language plpgsql security definer set search_path to ''
as $function$
declare o public.offer_letters; v_id uuid;
begin
  perform private.require(private.is_admin(), 'Admin only');
  perform private.require(exists (select 1 from public.employees where id = p_employee_id), 'Employee not found');
  perform private.require(length(btrim(coalesce(p_body, ''))) between 20 and 30000, 'Write the offer letter');
  perform private.require(jsonb_typeof(coalesce(p_clauses, '[]'::jsonb)) = 'array', 'Invalid terms');
  perform private.require(p_expires_on is null or p_expires_on >= private.today_ist(), 'The expiry date is in the past');
  select * into o from public.offer_letters where employee_id = p_employee_id and status in ('Draft','Sent') for update;
  if o.id is not null and o.status = 'Draft' then
    update public.offer_letters set template_code = p_template_code, title = coalesce(nullif(btrim(p_title), ''), title),
      body = btrim(p_body), clauses = coalesce(p_clauses, '[]'::jsonb), fields = coalesce(p_fields, '{}'::jsonb),
      expires_on = p_expires_on, updated_at = now()
    where id = o.id;
    return o.id;
  end if;
  if o.id is not null then  -- a sent offer is replaced by a new version, which must be accepted again
    update public.offer_letters set status = 'Withdrawn', withdrawn_at = now(), updated_at = now() where id = o.id;
  end if;
  insert into public.offer_letters (employee_id, template_code, version_no, title, body, clauses, fields, expires_on, created_by)
  values (p_employee_id, p_template_code,
          coalesce((select max(version_no) from public.offer_letters where employee_id = p_employee_id), 0) + 1,
          coalesce(nullif(btrim(p_title), ''), 'Offer of employment'), btrim(p_body), coalesce(p_clauses, '[]'::jsonb),
          coalesce(p_fields, '{}'::jsonb), p_expires_on, auth.uid())
  returning id into v_id;
  return v_id;
end $function$;

create or replace function public.offer_send(p_offer_id uuid, p_expires_on date)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare o public.offer_letters;
begin
  perform private.require(private.is_admin(), 'Admin only');
  select * into o from public.offer_letters where id = p_offer_id for update;
  perform private.require(found, 'Offer not found');
  perform private.require(o.status = 'Draft', 'Only a draft offer can be sent');
  perform private.require(length(o.body) >= 20, 'Write the offer letter before sending');
  perform private.require(p_expires_on is not null and p_expires_on >= private.today_ist(), 'Set an expiry date from today onwards');
  update public.offer_letters set status = 'Sent', sent_at = now(), expires_on = p_expires_on, updated_at = now() where id = o.id;
  perform private.notify_employee(o.employee_id, 'system', 'Your offer letter is ready',
    'Please review and accept it by ' || to_char(p_expires_on, 'DD Mon YYYY') || '.', '/emp-dashboard', 'offer-sent:' || o.id);
end $function$;

create or replace function public.offer_extend(p_offer_id uuid, p_expires_on date)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare o public.offer_letters;
begin
  perform private.require(private.is_admin(), 'Admin only');
  select * into o from public.offer_letters where id = p_offer_id for update;
  perform private.require(found and o.status = 'Sent', 'Only a sent offer can be extended');
  perform private.require(p_expires_on >= private.today_ist(), 'Pick a date from today onwards');
  update public.offer_letters set expires_on = p_expires_on, updated_at = now() where id = o.id;
  perform private.notify_employee(o.employee_id, 'system', 'Your offer was extended',
    'You can accept it until ' || to_char(p_expires_on, 'DD Mon YYYY') || '.', '/emp-dashboard', 'offer-extend:' || o.id || ':' || p_expires_on);
end $function$;

create or replace function public.offer_withdraw(p_offer_id uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  perform private.require(private.is_admin(), 'Admin only');
  update public.offer_letters set status = 'Withdrawn', withdrawn_at = now(), updated_at = now()
   where id = p_offer_id and status in ('Draft','Sent');
  perform private.require(found, 'Only a draft or sent offer can be withdrawn');
end $function$;

-- The employee accepts (typing their name) or declines (with a reason). Expired offers cannot be accepted.
create or replace function public.offer_respond(p_offer_id uuid, p_accept boolean, p_signer_name text default null, p_reason text default null)
 returns text language plpgsql security definer set search_path to ''
as $function$
declare o public.offer_letters; v_name text := btrim(coalesce(p_signer_name, '')); v_reason text := btrim(coalesce(p_reason, '')); v_emp text;
begin
  select * into o from public.offer_letters where id = p_offer_id for update;
  perform private.require(found and o.employee_id = private.current_employee_id(), 'Offer not found');
  perform private.require(o.status = 'Sent', 'This offer is not waiting for your answer');
  perform private.require(o.expires_on is null or o.expires_on >= private.today_ist(), 'This offer has expired. Ask the company to extend it.');
  select name into v_emp from public.employees where id = o.employee_id;
  if p_accept then
    perform private.require(length(v_name) between 3 and 120, 'Type your full name to accept');
    update public.offer_letters set status = 'Accepted', accepted_at = now(), signer_name = v_name, updated_at = now() where id = o.id;
    perform private.notify_admins('system', 'Offer accepted', coalesce(v_emp, 'An employee') || ' accepted their offer letter.', '/admin-employees', 'offer-accepted:' || o.id);
    return 'Accepted';
  end if;
  perform private.require(length(v_reason) between 3 and 1000, 'Tell us why you are declining');
  update public.offer_letters set status = 'Declined', declined_at = now(), decline_reason = v_reason, updated_at = now() where id = o.id;
  perform private.notify_admins('system', 'Offer declined', coalesce(v_emp, 'An employee') || ' declined their offer: ' || left(v_reason, 140), '/admin-employees', 'offer-declined:' || o.id);
  return 'Declined';
end $function$;

-- Is the signed-in employee waiting on an offer? Existing employees with no offer are never gated.
create or replace function public.my_offer_gate()
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select case
    when private.current_employee_id() is null then jsonb_build_object('gated', false)
    when exists (select 1 from public.offer_letters where employee_id = private.current_employee_id() and status = 'Accepted')
      then jsonb_build_object('gated', false)
    when not exists (select 1 from public.offer_letters where employee_id = private.current_employee_id())
      then jsonb_build_object('gated', false)
    else (select jsonb_build_object('gated', true, 'status',
                   case when o.status = 'Sent' and o.expires_on < private.today_ist() then 'Expired' else o.status end,
                   'offer_id', case when o.status <> 'Draft' then o.id end)
            from public.offer_letters o where o.employee_id = private.current_employee_id()
           order by o.created_at desc limit 1)
  end
$function$;

-- Templates and clauses (Settings).
create or replace function public.offer_template_save(p_code text, p_name text, p_type text, p_body text, p_clause_codes text[], p_active boolean)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  perform private.require(private.is_admin(), 'Admin only');
  insert into public.offer_templates (code, name, employment_type, body, clause_codes, active)
  values (p_code, btrim(p_name), p_type, btrim(p_body), coalesce(p_clause_codes, '{}'), coalesce(p_active, true))
  on conflict (code) do update set name = excluded.name, employment_type = excluded.employment_type, body = excluded.body,
    clause_codes = excluded.clause_codes, active = excluded.active, updated_at = now();
end $function$;

create or replace function public.offer_clause_save(p_code text, p_title text, p_body text, p_sort int, p_active boolean)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  perform private.require(private.is_admin(), 'Admin only');
  insert into public.offer_clauses (code, title, body, sort, active)
  values (p_code, btrim(p_title), btrim(p_body), coalesce(p_sort, 100), coalesce(p_active, true))
  on conflict (code) do update set title = excluded.title, body = excluded.body, sort = excluded.sort, active = excluded.active, updated_at = now();
end $function$;

revoke all on function public.offer_save(uuid, text, text, text, jsonb, jsonb, date) from public, anon;
revoke all on function public.offer_send(uuid, date) from public, anon;
revoke all on function public.offer_extend(uuid, date) from public, anon;
revoke all on function public.offer_withdraw(uuid) from public, anon;
revoke all on function public.offer_respond(uuid, boolean, text, text) from public, anon;
revoke all on function public.my_offer_gate() from public, anon;
revoke all on function public.offer_template_save(text, text, text, text, text[], boolean) from public, anon;
revoke all on function public.offer_clause_save(text, text, text, int, boolean) from public, anon;
grant execute on function public.offer_save(uuid, text, text, text, jsonb, jsonb, date) to authenticated;
grant execute on function public.offer_send(uuid, date) to authenticated;
grant execute on function public.offer_extend(uuid, date) to authenticated;
grant execute on function public.offer_withdraw(uuid) to authenticated;
grant execute on function public.offer_respond(uuid, boolean, text, text) to authenticated;
grant execute on function public.my_offer_gate() to authenticated;
grant execute on function public.offer_template_save(text, text, text, text, text[], boolean) to authenticated;
grant execute on function public.offer_clause_save(text, text, text, int, boolean) to authenticated;
-- 3. Starting templates and terms (editable in Settings) ---------------------------------------------
insert into public.offer_clauses (code, title, body, sort) values
('probation','Probation','You will be on probation for {probation_months} months from your date of joining. At the end of it your work will be reviewed and, if satisfactory, you will be confirmed in writing. During probation either side may end employment with {probation_notice} notice.',10),
('confidentiality','Confidentiality','You will keep confidential all information about the company, its clients, projects, prices, designs and people that you learn during your work, both during and after your employment. You will not share it with anyone outside the company or use it for any other purpose.',20),
('ip','Ownership of work','All work you create in the course of your role, including designs, files, code, documents and ideas, belongs to the company from the moment it is created. You will sign any document needed to confirm this.',30),
('exclusivity','Exclusive service','While employed full-time you will not take up any other job, freelance work or business without the company''s written consent.',40),
('conflict_of_interest','Other work','You may work elsewhere outside your agreed hours, provided it is not for a competitor or client of the company, does not use company time, equipment or information, and you tell the company in writing before you start.',41),
('non_solicit','No poaching','For {non_solicit_months} months after you leave, you will not approach the company''s clients or employees to move their business or employment away from the company.',50),
('conduct_posh','Code of conduct and POSH','You will follow the company''s code of conduct. The company has zero tolerance for harassment; its Prevention of Sexual Harassment (POSH) policy applies in the office and in calls, chats and online meetings.',60),
('attendance','Attendance and working time','You will record your attendance and working time in SIGMA (check-in, check-out and task timers) as instructed. Working hours are as stated in this letter.',70),
('leave','Leave','Leave is as per the company leave policy in force from time to time, which is available in SIGMA.',80),
('statutory','Statutory benefits','Provident Fund, ESI and gratuity apply as per law where you are eligible.',90),
('notice','Notice and termination','After confirmation either side may end employment with {notice_period} written notice, or pay in lieu of notice at the company''s discretion. The company may end employment immediately for serious misconduct, dishonesty or a breach of these terms.',100),
('garden_leave','Garden leave','During your notice period the company may ask you not to work or attend, on full pay. You remain an employee and bound by these terms until your last working day.',110),
('remote_work','Remote work','You will work from a quiet, private workspace with a stable internet connection, be reachable by call and chat during working hours, and tell the company in writing before working from a different city or state.',120),
('equipment','Company equipment','Equipment provided by the company remains its property, is for work use only, and must be returned in good condition on or before your last working day.',130),
('data_security','Data security','Use only company-approved tools and accounts. Keep devices locked, do not let others use work devices, do not keep company data on personal storage, USB drives or personal cloud accounts, and report any loss or data breach within 24 hours.',140),
('monitoring','What SIGMA records','SIGMA records your check-in, check-out, task timers and progress check-ins. No camera or screen recording is used unless you are told in writing first.',150),
('background','Verification','This offer is conditional on satisfactory verification of the documents and information you have provided. You consent to the company carrying out these checks.',160),
('return_property','Return of property','Before your final settlement you will return all company property, including devices, ID cards, documents and files.',170),
('e_acceptance','Electronic acceptance','Accepting this offer in SIGMA by typing your full name is your signature and is binding under the Information Technology Act, 2000.',180),
('governing_law','Governing law','This offer is governed by the laws of India. Courts at {jurisdiction_city} have jurisdiction.',190),
('intern_no_job','No promise of employment','This internship does not guarantee a job offer. A full-time offer, if made, will be a separate letter.',200),
('intern_portfolio','Using internship work','Work created during the internship belongs to the company. You may show it in a portfolio only with the company''s written permission.',210)
on conflict (code) do nothing;

insert into public.offer_templates (code, name, employment_type, clause_codes, body) values
('full_time','Full-time (office)','full_time',
 array['probation','confidentiality','ip','exclusivity','non_solicit','conduct_posh','attendance','leave','statutory','notice','garden_leave','data_security','background','return_property','e_acceptance','governing_law'],
 E'Dear {employee_name},\n\nWe are pleased to offer you the full-time, permanent position of {designation} in {department}, on the terms below.\n\n1. Place of work: our office at {work_location}.\n2. Working hours: {working_days}, {working_hours}. Attendance is recorded through SIGMA check-in and check-out.\n3. Compensation: a total annual cost to company of {ctc_annual} (monthly gross {monthly_gross}), paid monthly by the {pay_day} of the following month.\n4. Date of joining: {joining_date}.\n5. Probation: {probation_months} months from your joining date.\n6. Reporting: you will report to {reporting_manager}.\n7. Notice period after confirmation: {notice_period}.\n\nThe terms and conditions below form part of this offer. This offer is valid until {offer_expiry_date}.\n\nWe look forward to welcoming you.\n\n{signatory_name}\n{signatory_title}, {company_name}'),
('wfh','Work from home (remote)','wfh',
 array['probation','confidentiality','ip','exclusivity','non_solicit','conduct_posh','attendance','leave','statutory','notice','remote_work','equipment','data_security','monitoring','background','return_property','e_acceptance','governing_law'],
 E'Dear {employee_name},\n\nWe are pleased to offer you the full-time, remote position of {designation} in {department}, on the terms below.\n\n1. Place of work: you will work remotely from your home at {home_city}, {home_state}. Tell us in writing before working from a different city or state.\n2. Working hours: {working_days}, {working_hours} IST. You must be reachable by call and chat during these hours. Attendance is recorded through SIGMA check-in; work time is tracked against tasks.\n3. Equipment: {equipment_clause}\n4. Internet and costs: {internet_allowance} per month towards internet and electricity, paid with salary.\n5. Compensation: a total annual cost to company of {ctc_annual} (monthly gross {monthly_gross}), paid monthly.\n6. Date of joining: {joining_date}. Probation: {probation_months} months.\n7. Reporting: you will report to {reporting_manager}. You may be asked to attend the office for onboarding, reviews or team days with {visit_notice} notice; travel for these is reimbursed as per policy.\n8. Notice period after confirmation: {notice_period}.\n\nThe terms and conditions below form part of this offer. This offer is valid until {offer_expiry_date}.\n\n{signatory_name}\n{signatory_title}, {company_name}'),
('hybrid','Hybrid','hybrid',
 array['probation','confidentiality','ip','exclusivity','non_solicit','conduct_posh','attendance','leave','statutory','notice','remote_work','data_security','background','return_property','e_acceptance','governing_law'],
 E'Dear {employee_name},\n\nWe are pleased to offer you the full-time position of {designation} in {department}, on a hybrid basis, on the terms below.\n\n1. Place of work: our office at {work_location}. You will work from the office at least {office_days_per_week} days a week ({fixed_office_days}, or as your manager schedules) and from home on the other working days.\n2. Working hours: {working_days}, {working_hours}, the same on office and home days. Office days are recorded by SIGMA check-in at the office; home days as work from home.\n3. The hybrid split is a working arrangement, not a contractual right; the company may change the number of office days with {hybrid_change_notice} written notice.\n4. Compensation: a total annual cost to company of {ctc_annual} (monthly gross {monthly_gross}), paid monthly.\n5. Date of joining: {joining_date}. Probation: {probation_months} months.\n6. Reporting: you will report to {reporting_manager}.\n7. Notice period after confirmation: {notice_period}.\n\nThe terms and conditions below form part of this offer. This offer is valid until {offer_expiry_date}.\n\n{signatory_name}\n{signatory_title}, {company_name}'),
('part_time','Part-time','part_time',
 array['probation','confidentiality','ip','conflict_of_interest','conduct_posh','attendance','leave','statutory','notice','data_security','return_property','e_acceptance','governing_law'],
 E'Dear {employee_name},\n\nWe are pleased to offer you the part-time position of {designation} in {department}.\n\n1. Hours: up to {hours_per_week} hours a week, on {part_time_days} between {part_time_hours}, or as agreed with your manager each week. Hours are recorded through SIGMA check-in and task timers.\n2. Place of work: {work_location}.\n3. Pay: {hourly_rate} per hour, paid monthly for hours recorded in SIGMA and approved by your manager. Work beyond {hours_per_week} hours a week needs your manager''s prior approval.\n4. Date of joining: {joining_date}. Probation: {probation_months} months.\n5. Leave: paid leave on a pro-rata basis to your hours, as per the company leave policy.\n6. Reporting: you will report to {reporting_manager}.\n7. Notice period: {notice_period}.\n\nThe terms and conditions below form part of this offer. This offer is valid until {offer_expiry_date}.\n\n{signatory_name}\n{signatory_title}, {company_name}'),
('intern','Intern','intern',
 array['confidentiality','intern_portfolio','conduct_posh','attendance','data_security','return_property','intern_no_job','e_acceptance','governing_law'],
 E'Dear {employee_name},\n\nWe are pleased to offer you an internship as {designation} in {department}.\n\n1. Duration: from {joining_date} to {internship_end_date}. It may be extended by mutual written agreement.\n2. Place of work: {work_location}.\n3. Hours: {working_days}, {working_hours}. Attendance is recorded through SIGMA.\n4. Stipend: {stipend_monthly} per month, paid by the {pay_day} of the following month. The stipend is not a salary and carries no other benefits.\n5. Mentor: {reporting_manager} will guide and review your work.\n6. Leave: {intern_leave_days} days over the internship, approved in advance.\n7. Ending early: either side may end the internship with {intern_notice} written notice.\n8. Certificate: on completing the internship and returning all company property, you will receive an internship certificate.\n\nThe terms and conditions below form part of this offer. This offer is valid until {offer_expiry_date}.\n\n{signatory_name}\n{signatory_title}, {company_name}')
on conflict (code) do nothing;

-- offer_letters_4_gate_order: my_offer_gate picks the newest offer by version number
-- (created_at alone can tie). Same body as above with:
--   order by o.version_no desc, o.created_at desc limit 1
