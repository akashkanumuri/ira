-- v2_manager_designer_assignment_visibility
-- Managers can assign tasks to active Designers regardless of manager_id.
-- Other Manager assignment rules retain their existing scope.

UPDATE public.task_assignment_rules
SET scope = 'any'
WHERE id = '04cbde48-a107-4094-aad3-b8936305b520';
