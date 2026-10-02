-- Prevent duplicate assignment rules.
create unique index if not exists task_assignment_rules_unique_idx
on public.task_assignment_rules(assigner_designation_id,assignee_designation_id,scope);
