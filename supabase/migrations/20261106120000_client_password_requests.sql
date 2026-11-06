-- SIGMA 1 — "Forgot password" for clients without any email.
-- The client asks from the login page; admins get a priority alert (only admins can create links),
-- create a one-time reset link in SIGMA and share it themselves (WhatsApp, their own email).
-- The login page always answers the same way, so it can't be used to discover which emails have accounts.

create table if not exists public.client_password_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) between 3 and 320),
  client_id uuid references public.clients(id) on delete cascade,
  client_user_id uuid references public.client_users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null
);
create index if not exists client_password_requests_open_idx on public.client_password_requests(requested_at desc) where handled_at is null;
create index if not exists client_password_requests_email_idx on public.client_password_requests(lower(email), requested_at desc);
alter table public.client_password_requests enable row level security;
drop policy if exists client_password_requests_staff_select on public.client_password_requests;
create policy client_password_requests_staff_select on public.client_password_requests for select to authenticated using (private.is_admin());
revoke insert, update, delete on public.client_password_requests from anon, authenticated;
grant select on public.client_password_requests to authenticated;

/** Called from the client login page (signed out). Always returns the same answer. */
create or replace function public.client_request_password_reset(p_email text)
 returns text language plpgsql security definer set search_path to ''
as $function$
declare v_email text := lower(btrim(coalesce(p_email, ''))); cu public.client_users; c public.clients; r record; v_id uuid; v_who text;
  v_done constant text := 'Your account manager has been told. They will send you a new link.';
begin
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 320 then
    raise exception 'Enter the email you sign in with' using errcode = 'P0001';
  end if;
  -- Throttle: one alert per email every 15 minutes, and a ceiling for the whole page.
  if exists (select 1 from public.client_password_requests where lower(email) = v_email and requested_at > now() - interval '15 minutes')
     or (select count(*) from public.client_password_requests where requested_at > now() - interval '10 minutes') >= 30 then
    return v_done;
  end if;
  select * into cu from public.client_users where lower(email) = v_email and status <> 'inactive' limit 1;
  if cu.id is not null then
    select * into c from public.clients where id = cu.client_id and deleted_at is null and status <> 'inactive';
  else
    select * into c from public.clients where lower(email) = v_email and deleted_at is null and status <> 'inactive' limit 1;
  end if;
  if c.id is null then
    return v_done; -- unknown email: same answer, nothing stored
  end if;
  insert into public.client_password_requests(email, client_id, client_user_id) values (v_email, c.id, cu.id) returning id into v_id;
  v_who := coalesce(nullif(btrim(cu.full_name), ''), nullif(btrim(c.primary_contact), ''), v_email);
  for r in select p.id from public.profiles p where p.role = 'admin' loop
    perform private.notify(r.id, 'client', 'Password reset requested',
      v_who || ' (' || c.company_name || ') asked for a new password link. Create the link and share it with them.',
      '/admin-clients?client=' || c.id || '&reset=' || v_id, 'pw-request:' || v_id,
      jsonb_build_object('priority', 'high', 'request_id', v_id, 'client_id', c.id, 'email', v_email));
  end loop;
  return v_done;
end $function$;
revoke all on function public.client_request_password_reset(text) from public;
grant execute on function public.client_request_password_reset(text) to anon, authenticated;

/** Open requests (admins only). */
create or replace function public.staff_password_requests()
 returns table(id uuid, email text, client_id uuid, client_user_id uuid, company_name text, person text, requested_at timestamptz)
 language sql stable security definer set search_path to ''
as $function$
  select r.id, r.email, r.client_id, r.client_user_id, c.company_name,
         coalesce(nullif(btrim(cu.full_name), ''), nullif(btrim(c.primary_contact), ''), r.email), r.requested_at
  from public.client_password_requests r
  join public.clients c on c.id = r.client_id
  left join public.client_users cu on cu.id = r.client_user_id
  where r.handled_at is null and r.requested_at > now() - interval '14 days'
    and private.is_admin()
  order by r.requested_at desc
$function$;
revoke all on function public.staff_password_requests() from public, anon;
grant execute on function public.staff_password_requests() to authenticated;

/** Called after an admin creates a reset/setup link for someone: closes their open requests. */
create or replace function public.staff_close_password_requests(p_email text)
 returns integer language plpgsql security definer set search_path to ''
as $function$
declare n int;
begin
  perform private.require(private.is_admin(), 'Only an admin can do this');
  update public.client_password_requests set handled_at = now(), handled_by = auth.uid()
  where handled_at is null and lower(email) = lower(btrim(coalesce(p_email, '')));
  get diagnostics n = row_count;
  update public.notifications set read_at = coalesce(read_at, now())
  where idempotency_key like 'pw-request:%' and read_at is null
    and metadata->>'email' = lower(btrim(coalesce(p_email, '')));
  return n;
end $function$;
revoke all on function public.staff_close_password_requests(text) from public, anon;
grant execute on function public.staff_close_password_requests(text) to authenticated;
