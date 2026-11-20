-- Phone / desktop alerts are labelled by the browser with the web address that registered them.
-- Remember which address each device registered from, so only sigma1.in registrations get alerts
-- (old ira-eta-two.vercel.app registrations stop; people turn alerts on again at sigma1.in).
alter table public.push_subscriptions add column if not exists origin text;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_sub_id uuid;
  v_origin text := left(nullif(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> 'origin', ''), 120);
begin
  if v_user_id is null then raise exception 'Authentication required to save push subscription'; end if;
  if private.offer_locked() then raise exception 'Accept your offer letter first'; end if;
  if p_endpoint is null or p_p256dh is null or p_auth is null then raise exception 'Invalid subscription credentials'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Invalid subscription endpoint'; end if;
  -- This browser now belongs to the person signed in on it: stop sending the previous person's alerts here.
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> v_user_id;
  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth, user_agent, origin, updated_at)
  values (v_user_id, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300), v_origin, now())
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, origin = excluded.origin, updated_at = now()
  returning id into v_sub_id;
  return v_sub_id;
end $$;
