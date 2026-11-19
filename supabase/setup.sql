-- KFL South Draft — live spectator tables.
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.

-- Small, frequently-changing draft state (signings, current player, bids, view).
create table if not exists public.kfl_live (
  id          text primary key,
  seq         bigint      not null default 0,
  live        jsonb,
  roster_hash text,
  updated_at  timestamptz not null default now()
);

-- Larger, rarely-changing data (team names, player details, photo framing).
create table if not exists public.kfl_roster (
  id         text primary key,
  hash       text,
  data       jsonb,
  updated_at timestamptz not null default now()
);

alter table public.kfl_live   enable row level security;
alter table public.kfl_roster enable row level security;

-- Everyone may READ. Nobody may write with the public key: only the Vercel
-- server function (service role / secret key) writes, after checking the
-- organiser password.
drop policy if exists "kfl_live public read"   on public.kfl_live;
drop policy if exists "kfl_roster public read" on public.kfl_roster;
create policy "kfl_live public read"   on public.kfl_live   for select to anon, authenticated using (true);
create policy "kfl_roster public read" on public.kfl_roster for select to anon, authenticated using (true);

grant select on public.kfl_live, public.kfl_roster to anon, authenticated;
grant all    on public.kfl_live, public.kfl_roster to service_role;

-- Seed the rows for the default event id.
insert into public.kfl_live   (id) values ('kfl-south') on conflict (id) do nothing;
insert into public.kfl_roster (id) values ('kfl-south') on conflict (id) do nothing;

-- Turn on Realtime for the live table.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kfl_live'
  ) then
    alter publication supabase_realtime add table public.kfl_live;
  end if;
end $$;

-- Optional: reset before the real event (clears the spectator view only;
-- the organiser laptop keeps its own saved draft).
-- update public.kfl_live set seq = 0, live = null, roster_hash = null where id = 'kfl-south';
