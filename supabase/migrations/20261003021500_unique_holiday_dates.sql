-- Keep one canonical holiday entry per calendar date.
create unique index if not exists holidays_date_unique_idx on public.holidays(date);
