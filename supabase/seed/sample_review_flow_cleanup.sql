-- Removes ONLY the sample data created by sample_review_flow.sql (project "Sample · Spring campaign").
-- Review before running; it deletes rows. Notifications created by the seed are left in place.
begin;
do $clean$
declare pr uuid := (select id from public.projects where name = 'Sample · Spring campaign');
begin
  if pr is null then raise notice 'No sample project'; return; end if;
  perform set_config('sigma.task_rpc', 'on', true);
  delete from public.support_requests where project_id = pr;          -- messages cascade
  delete from public.deliverable_comments where project_id = pr;
  delete from public.deliverable_client_reviews where project_id = pr;
  delete from public.task_time_logs where task_id in (select id from public.tasks where project_id = pr or title like 'Sample · %');
  delete from public.task_events where task_id in (select id from public.tasks where project_id = pr or title like 'Sample · %');
  delete from public.tasks where project_id = pr or title like 'Sample · %'; -- drafts, comments, timers cascade
  delete from public.deliverables where project_id = pr;
  delete from public.project_managers where project_id = pr;
  delete from public.projects where id = pr;
end
$clean$;
commit;
