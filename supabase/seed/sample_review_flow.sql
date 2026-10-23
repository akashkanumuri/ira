-- SIGMA 1 — labelled sample data to walk through the review flow.
--
-- Uses the existing test accounts: manager ANTREENA (EMP0002), satish (EMP0003), jcob (EMP0004),
-- client "jk". Everything lives in ONE project named "Sample · Spring campaign" and every task title
-- starts with "Sample ·", so it is easy to find and remove (see sample_review_flow_cleanup.sql).
-- Run once, after the review-flow migrations. Safe to re-run: it stops if the project exists.

do $seed$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  e_mgr uuid; p_mgr uuid; e_sat uuid; e_jc uuid; cl uuid; p_client uuid; pr uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid;
  dr uuid; r1 uuid; sr uuid;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  base timestamptz := date_trunc('day', now()) - interval '18 days' + interval '10 hours';
begin
  select id, profile_id into e_mgr, p_mgr from public.employees where emp_id = 'EMP0002';
  select id into e_sat from public.employees where emp_id = 'EMP0003';
  select id into e_jc from public.employees where emp_id = 'EMP0004';
  select id, profile_id into cl, p_client from public.clients where company_name = 'jk' order by created_at limit 1;
  if e_mgr is null or e_sat is null or e_jc is null or cl is null then raise exception 'Test accounts not found'; end if;
  if exists (select 1 from public.projects where name = 'Sample · Spring campaign') then raise exception 'Sample data already present'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('sigma.task_rpc', 'on', true);

  insert into public.projects(name, client_id, status) values ('Sample · Spring campaign', cl, 'active') returning id into pr;
  insert into public.project_managers(project_id, manager_id) values (pr, e_mgr);

  insert into public.deliverables(project_id, client_id, deliverable_number, name, description, quantity, unit, due_date, responsible_id, status, priority)
  values
    (pr, cl, 'SMP-01', 'Launch reel (30 sec)', 'Hero video for the spring launch, 9:16 and 16:9.', 1, 'video', today - 2, e_sat, 'Completed', 'High')
    returning id into d1;
  insert into public.deliverables(project_id, client_id, deliverable_number, name, description, quantity, unit, due_date, responsible_id, status, priority)
  values (pr, cl, 'SMP-02', 'Instagram carousel', 'Five-slide product carousel.', 5, 'slides', today + 2, e_sat, 'Awaiting Client Review', 'Medium') returning id into d2;
  insert into public.deliverables(project_id, client_id, deliverable_number, name, description, quantity, unit, due_date, responsible_id, status, priority)
  values (pr, cl, 'SMP-03', 'Product poster (A2)', 'Print-ready poster for retail.', 1, 'poster', today + 4, e_jc, 'Under Internal Review', 'Medium') returning id into d3;
  insert into public.deliverables(project_id, client_id, deliverable_number, name, description, quantity, unit, due_date, responsible_id, status, priority)
  values (pr, cl, 'SMP-04', 'Website hero banners', 'Desktop and mobile hero banners.', 3, 'banners', today + 3, e_sat, 'In Progress', 'High') returning id into d4;
  insert into public.deliverables(project_id, client_id, deliverable_number, name, description, quantity, unit, due_date, responsible_id, status, priority)
  values (pr, cl, 'SMP-05', 'Brand guideline PDF', 'Logo, colour, type and usage rules.', 1, 'document', today + 9, e_jc, 'Pending', 'Low') returning id into d5;

  -- T1 · satish · reel: 3 internal drafts, 2 client versions, approved -----------------------------
  insert into public.tasks(title, description, assigned_to, assigned_by, start_date, due_date, priority, status, project_id, deliverable_id,
                           estimate_minutes, progress_pct, accepted_at, started_at, submitted_link, submitted_at, completed_at, reviewed_by, reviewed_at, created_at)
  values ('Sample · Edit the launch reel', 'Cut a 30-second reel from the shoot. Brand colours, logo end-card, licensed music only.',
          e_sat, e_mgr, today - 18, today - 4, 'high', 'completed', pr, d1, 720, 100, base, base + interval '2 hours',
          'https://drive.google.com/sample/launch-reel-v3', base + interval '13 days', base + interval '13 days 3 hours', p_mgr, base + interval '13 days 3 hours', base)
  returning id into t1;
  insert into public.task_drafts(task_id, draft_no, link, note, submitted_by, submitted_at, on_time, decision, decided_by, decided_at, feedback) values
    (t1, 1, 'https://drive.google.com/sample/launch-reel-v1', 'First cut, 34 sec.', e_sat, base + interval '5 days', true, 'changes_requested', p_mgr, base + interval '5 days 4 hours', 'Logo end-card is too small and the music is too loud under the voice-over.'),
    (t1, 2, 'https://drive.google.com/sample/launch-reel-v2', 'Bigger end-card, music ducked by 6 dB, trimmed to 30 sec.', e_sat, base + interval '7 days', true, 'approved', p_mgr, base + interval '7 days 2 hours', 'Good to show the client.'),
    (t1, 3, 'https://drive.google.com/sample/launch-reel-v3', 'Intro shortened to 3 sec as the client asked.', e_sat, base + interval '13 days', false, 'approved', p_mgr, base + interval '13 days 3 hours', null);
  select id into dr from public.task_drafts where task_id = t1 and draft_no = 2;
  insert into public.deliverable_client_reviews(deliverable_id, project_id, client_id, task_id, draft_id, round_no, link, message, sent_by, sent_at, status, client_comment, decided_by, decided_at, forwarded_by, forwarded_at, forward_note)
  values (d1, pr, cl, t1, dr, 1, 'https://drive.google.com/sample/launch-reel-v2', 'First version of the launch reel.', p_mgr, base + interval '7 days 3 hours',
          'changes_requested', 'Love it. Please make the intro shorter, about 3 seconds before the product shows.', p_client, base + interval '9 days', p_mgr, base + interval '9 days 2 hours', 'Keep the music cue on the product reveal.')
  returning id into r1;
  select id into dr from public.task_drafts where task_id = t1 and draft_no = 3;
  insert into public.deliverable_client_reviews(deliverable_id, project_id, client_id, task_id, draft_id, round_no, link, message, sent_by, sent_at, status, client_comment, decided_by, decided_at)
  values (d1, pr, cl, t1, dr, 2, 'https://drive.google.com/sample/launch-reel-v3', 'Intro shortened as requested.', p_mgr, base + interval '13 days 4 hours',
          'approved', 'Perfect, approved.', p_client, base + interval '14 days');
  insert into public.task_comments(task_id, author_id, body, created_at) values
    (t1, p_mgr, 'Use the licensed track from the brand folder, not the stock one.', base + interval '1 day'),
    (t1, (select profile_id from public.employees where id = e_sat), 'Got it. Should the end-card hold for 2 or 3 seconds?', base + interval '1 day 1 hour'),
    (t1, p_mgr, '3 seconds, with the website URL.', base + interval '1 day 2 hours'),
    (t1, p_mgr, 'Client feedback on version 1: “Love it. Please make the intro shorter, about 3 seconds before the product shows.”' || E'\n\n' || 'Keep the music cue on the product reveal.', base + interval '9 days 2 hours');
  insert into public.task_time_logs(task_id, employee_id, work_date, minutes, note, created_at) values
    (t1, e_sat, (base + interval '2 days')::date, 240, 'Rough cut', base + interval '2 days'),
    (t1, e_sat, (base + interval '4 days')::date, 180, 'Colour and titles', base + interval '4 days'),
    (t1, e_sat, (base + interval '6 days')::date, 150, 'Fixes from draft 1', base + interval '6 days'),
    (t1, e_sat, (base + interval '12 days')::date, 90, 'Shorter intro', base + interval '12 days');
  update public.tasks set time_spent_minutes = 660 where id = t1;

  -- T2 · satish · carousel: approved on first draft, waiting for the client ------------------------
  insert into public.tasks(title, description, assigned_to, assigned_by, start_date, due_date, priority, status, project_id, deliverable_id,
                           estimate_minutes, progress_pct, accepted_at, started_at, submitted_link, submitted_at, completed_at, reviewed_by, reviewed_at, created_at)
  values ('Sample · Design the Instagram carousel', 'Five slides: hook, three features, call to action. 1080 × 1350.',
          e_sat, e_mgr, today - 8, today + 1, 'medium', 'completed', pr, d2, 360, 100, base + interval '10 days', base + interval '10 days',
          'https://www.figma.com/sample/carousel-v1', now() - interval '2 days', now() - interval '1 day 20 hours', p_mgr, now() - interval '1 day 20 hours', base + interval '10 days')
  returning id into t2;
  insert into public.task_drafts(task_id, draft_no, link, note, submitted_by, submitted_at, on_time, decision, decided_by, decided_at, feedback)
  values (t2, 1, 'https://www.figma.com/sample/carousel-v1', 'All five slides, copy from the brief.', e_sat, now() - interval '2 days', true, 'approved', p_mgr, now() - interval '1 day 20 hours', 'Clean. Sending to the client.')
  returning id into dr;
  insert into public.deliverable_client_reviews(deliverable_id, project_id, client_id, task_id, draft_id, round_no, link, message, sent_by, sent_at, status)
  values (d2, pr, cl, t2, dr, 1, 'https://www.figma.com/sample/carousel-v1', 'Five slides for review. Swipe through in the Figma prototype.', p_mgr, now() - interval '1 day 19 hours', 'pending');
  insert into public.task_time_logs(task_id, employee_id, work_date, minutes, note, created_at) values
    (t2, e_sat, today - 3, 200, 'Layouts', now() - interval '3 days'), (t2, e_sat, today - 2, 110, 'Copy and export', now() - interval '2 days');
  update public.tasks set time_spent_minutes = 310 where id = t2;

  -- T3 · jcob · poster: draft 1 waiting for the manager -------------------------------------------
  insert into public.tasks(title, description, assigned_to, assigned_by, start_date, due_date, priority, status, project_id, deliverable_id,
                           estimate_minutes, progress_pct, accepted_at, started_at, submitted_link, submitted_at, status_note, created_at)
  values ('Sample · Product poster A2', 'Print-ready, CMYK, 3 mm bleed. Use the hero shot.', e_jc, e_mgr, today - 5, today + 3, 'medium', 'awaiting_review', pr, d3,
          300, 100, now() - interval '5 days', now() - interval '4 days', 'https://www.canva.com/sample/poster-v1', now() - interval '3 hours', 'Exported as PDF/X-1a.', now() - interval '5 days')
  returning id into t3;
  insert into public.task_drafts(task_id, draft_no, link, note, submitted_by, submitted_at, on_time)
  values (t3, 1, 'https://www.canva.com/sample/poster-v1', 'Exported as PDF/X-1a.', e_jc, now() - interval '3 hours', true);
  insert into public.task_time_logs(task_id, employee_id, work_date, minutes, note, created_at) values (t3, e_jc, today - 1, 270, 'Layout and print prep', now() - interval '1 day');
  update public.tasks set time_spent_minutes = 270 where id = t3;

  -- T4 · satish · banners: changes requested on draft 1 --------------------------------------------
  insert into public.tasks(title, description, assigned_to, assigned_by, start_date, due_date, priority, status, project_id, deliverable_id,
                           estimate_minutes, progress_pct, accepted_at, started_at, submitted_link, submitted_at, status_note, reviewed_by, reviewed_at, created_at)
  values ('Sample · Website hero banners', 'Desktop 1920×800, mobile 1080×1350, one variant each for the three products.', e_sat, e_mgr, today - 6, today + 2, 'high', 'revision_required', pr, d4,
          480, 80, now() - interval '6 days', now() - interval '5 days', 'https://www.figma.com/sample/banners-v1', now() - interval '1 day', 'Headline is hard to read on mobile; move it above the product and increase contrast.', p_mgr, now() - interval '20 hours', now() - interval '6 days')
  returning id into t4;
  insert into public.task_drafts(task_id, draft_no, link, note, submitted_by, submitted_at, on_time, decision, decided_by, decided_at, feedback)
  values (t4, 1, 'https://www.figma.com/sample/banners-v1', 'All six sizes.', e_sat, now() - interval '1 day', true, 'changes_requested', p_mgr, now() - interval '20 hours', 'Headline is hard to read on mobile; move it above the product and increase contrast.');
  insert into public.task_comments(task_id, author_id, body, created_at) values
    ((t4), (select profile_id from public.employees where id = e_sat), 'Should the mobile version keep the price tag?', now() - interval '18 hours'),
    ((t4), p_mgr, 'Yes, keep the price, but smaller than the headline.', now() - interval '17 hours');
  insert into public.task_time_logs(task_id, employee_id, work_date, minutes, note, created_at) values (t4, e_sat, today - 2, 300, 'Six banner sizes', now() - interval '2 days');
  update public.tasks set time_spent_minutes = 300 where id = t4;

  -- T5 · jcob · guidelines: new, not accepted yet --------------------------------------------------
  insert into public.tasks(title, description, assigned_to, assigned_by, start_date, due_date, priority, status, project_id, deliverable_id, estimate_minutes, created_at)
  values ('Sample · Brand guideline PDF', '12–16 pages: logo, colour, typography, do and don’t examples.', e_jc, e_mgr, today, today + 8, 'low', 'assigned', pr, d5, 960, now() - interval '2 hours')
  returning id into t5;

  -- T6 · satish · overdue internal task (not client work) -----------------------------------------
  insert into public.tasks(title, description, assigned_to, assigned_by, start_date, due_date, priority, status, estimate_minutes, progress_pct, accepted_at, started_at, created_at)
  values ('Sample · Competitor moodboard', 'Collect 20 references from three competitors for the next pitch.', e_sat, e_mgr, today - 4, today - 1, 'medium', 'in_progress', 180, 60,
          now() - interval '4 days', now() - interval '3 days', now() - interval '4 days')
  returning id into t6;
  insert into public.task_time_logs(task_id, employee_id, work_date, minutes, note, created_at) values (t6, e_sat, today - 2, 95, 'References', now() - interval '2 days');
  update public.tasks set time_spent_minutes = 95 where id = t6;

  -- Activity trail for the reel ---------------------------------------------------------------------
  insert into public.task_events(task_id, event_type, actor_employee_id, metadata, created_at) values
    (t1, 'accepted', e_sat, '{}'::jsonb, base),
    (t1, 'in_progress', e_sat, '{}'::jsonb, base + interval '2 hours'),
    (t1, 'awaiting_review', e_sat, '{"note":"Draft 1"}'::jsonb, base + interval '5 days'),
    (t1, 'revision_required', e_mgr, '{"note":"Logo end-card is too small"}'::jsonb, base + interval '5 days 4 hours'),
    (t1, 'awaiting_review', e_sat, '{"note":"Draft 2"}'::jsonb, base + interval '7 days'),
    (t1, 'completed', e_mgr, '{}'::jsonb, base + interval '7 days 2 hours'),
    (t1, 'revision_required', e_mgr, '{"note":"Client feedback on version 1"}'::jsonb, base + interval '9 days 2 hours'),
    (t1, 'awaiting_review', e_sat, '{"note":"Draft 3"}'::jsonb, base + interval '13 days'),
    (t1, 'completed', e_mgr, '{}'::jsonb, base + interval '13 days 3 hours');

  -- Client ⇄ IRA thread on the carousel, and a support request -------------------------------------
  insert into public.deliverable_comments(deliverable_id, project_id, client_id, author_id, author_kind, author_name, body, visibility, created_at) values
    (d2, pr, cl, p_client, 'client', 'jk', 'Could we also see a dark-background version of slide 1?', 'client', now() - interval '6 hours'),
    (d2, pr, cl, p_mgr, 'staff', 'IRA team', 'Internal: worth doing, small change. Ask satish after the client decides.', 'internal', now() - interval '5 hours 30 minutes'),
    (d2, pr, cl, p_mgr, 'staff', 'IRA team', 'Sure, we can add a dark variant once you approve the layout.', 'client', now() - interval '5 hours');
  insert into public.support_requests(request_number, client_id, project_id, created_by, subject, category, status, priority, last_message_at, created_at)
  values ('SR-' || lpad(nextval('public.support_request_seq')::text, 5, '0'), cl, pr, p_client, 'Sample · When is the poster ready for print?', 'question', 'in_progress', 'normal', now() - interval '1 hour', now() - interval '3 hours')
  returning id into sr;
  insert into public.support_messages(request_id, author_id, author_kind, author_name, body, created_at) values
    (sr, p_client, 'client', 'jk', 'Our printer needs the file by Friday. Will the poster be ready?', now() - interval '3 hours'),
    (sr, p_mgr, 'staff', 'IRA team', 'Yes. It is in internal review now; you will get it for approval by Thursday.', now() - interval '1 hour');

  perform set_config('sigma.task_rpc', '', true);
  raise notice 'Sample data created in project %', pr;
end
$seed$;
