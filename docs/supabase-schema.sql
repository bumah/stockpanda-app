-- StockPanda — Supabase schema (Phase 1: Google login + Catch sync)
-- Run this once in Supabase SQL Editor.

-- ── Table ────────────────────────────────────────────────────
create table if not exists public.catches (
  id          bigserial primary key,
  user_id     uuid        not null references auth.users on delete cascade,
  ticker      text        not null,
  country     text        not null default '',
  company     text        not null default '',
  added_at    timestamptz not null default now(),
  unique (user_id, ticker, country)
);

create index if not exists catches_user_id_idx on public.catches (user_id);

-- ── Row-level security ──────────────────────────────────────
alter table public.catches enable row level security;

drop policy if exists "catches: select own" on public.catches;
drop policy if exists "catches: insert own" on public.catches;
drop policy if exists "catches: update own" on public.catches;
drop policy if exists "catches: delete own" on public.catches;

create policy "catches: select own"
  on public.catches for select
  using (auth.uid() = user_id);

create policy "catches: insert own"
  on public.catches for insert
  with check (auth.uid() = user_id);

create policy "catches: update own"
  on public.catches for update
  using (auth.uid() = user_id);

create policy "catches: delete own"
  on public.catches for delete
  using (auth.uid() = user_id);

-- ── Auto-set user_id from auth context on insert ─────────────
-- Clients just pass {ticker, country, company}; user_id is derived server-side.
create or replace function public.set_catches_user_id()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists catches_set_user_id on public.catches;
create trigger catches_set_user_id
  before insert on public.catches
  for each row execute function public.set_catches_user_id();
