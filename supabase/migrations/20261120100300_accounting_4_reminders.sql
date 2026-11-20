-- Accounting MVP, part 4: reminder schedule.
-- Before due (billing setting, default 3 days) · due today · 1 and 3 days late · then weekly ·
-- and a warning the day before access pauses (auto-lock + grace days). Messages carry the invoice number.
create or replace function private.refresh_billing_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_changed int := 0; v_today date := private.today_ist(); v_remind int; p uuid; v_due numeric;
  v_late int; v_label text; v_grace int; v_lock boolean; s public.billing_settings;
begin
  select * into s from public.billing_settings where id;
  v_remind := coalesce(s.reminder_days_before, 3);
  for r in select i.*, private.installment_status(i) as computed from public.payment_installments i where i.deleted_at is null loop
    if r.computed is distinct from r.status then
      update public.payment_installments set updated_at = now() where id = r.id;
      v_changed := v_changed + 1;
    end if;
    continue when r.term_no is not null and r.requested_at is null;
    continue when r.due_date is null or r.computed in ('Paid','Cancelled','Waived');
    v_due := r.amount + r.tax_amount - r.amount_paid;
    continue when v_due <= 0;
    v_label := coalesce(r.invoice_number || ' · ', '') || r.name;
    v_late := v_today - r.due_date;
    if r.due_date - v_today = v_remind then
      perform private.notify_client(r.client_id, 'billing', 'Payment due in ' || v_remind || ' days',
        v_label || ' · ₹' || to_char(v_due, 'FM99,99,99,999') || ' is due on ' || to_char(r.due_date, 'DD Mon YYYY') || '.', '/client/payments',
        'due-soon:' || r.id || ':' || r.due_date);
    elsif v_late = 0 then
      perform private.notify_client(r.client_id, 'billing', 'Payment due today',
        v_label || ' · ₹' || to_char(v_due, 'FM99,99,99,999') || ' is due today.', '/client/payments', 'due-today:' || r.id || ':' || r.due_date);
    elsif v_late in (1, 3) or (v_late > 3 and v_late % 7 = 0) then
      perform private.notify_client(r.client_id, 'billing', 'Payment overdue',
        v_label || ' · ₹' || to_char(v_due, 'FM99,99,99,999') || ' was due on ' || to_char(r.due_date, 'DD Mon YYYY') || '.', '/client/payments',
        'overdue:' || r.id || ':' || v_today);
      if v_late = 1 then
        perform private.notify_project_staff(r.project_id, 'billing', 'Payment overdue',
          v_label || ' was due on ' || to_char(r.due_date, 'DD Mon YYYY') || '.', '/admin/clients', 'overdue-staff:' || r.id, true);
      end if;
    end if;
    if v_late > 0 then
      select coalesce(cr.auto_lock_enabled, s.auto_lock_enabled), coalesce(cr.grace_days, s.grace_days)
        into v_lock, v_grace
      from (select 1) x left join public.client_billing_rules cr on cr.client_id = r.client_id;
      if coalesce(v_lock, false) and v_grace is not null and v_late = v_grace and v_grace >= 1 then
        perform private.notify_client(r.client_id, 'billing', 'Access pauses tomorrow',
          v_label || ' · ₹' || to_char(v_due, 'FM99,99,99,999') || ' is still due. Pay today to keep your project open.', '/client/payments',
          'grace-warn:' || r.id || ':' || r.due_date);
      end if;
    end if;
  end loop;
  for p in select distinct project_id from public.payment_installments where deleted_at is null
           union select distinct project_id from public.deliverables where lock_state = 'locked_payment' loop
    perform private.evaluate_project_locks(p);
  end loop;
  update public.contracts set status = 'Expired', updated_at = now()
  where status = 'Accepted' and end_date is not null and end_date < v_today and deleted_at is null;
  return jsonb_build_object('installments_changed', v_changed, 'ran_at', now());
end $$;
