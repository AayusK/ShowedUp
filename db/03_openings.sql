-- Step 4 of the track-record build. Run once in the Supabase SQL editor; safe to run again.
-- Run db/01_clubs.sql first. Row-level security is on with no policies, so only the server's
-- secret key can read or write.

-- An opening a club posts, with a rule: "at least min_count badges with this role".
create table if not exists public.openings (
  id text primary key,
  club_id text not null references public.clubs (id),
  title text not null,
  description text,
  role text,                           -- which role counts; empty = any verified badge
  min_count integer not null default 1,
  closes_at timestamptz,               -- empty = stays open
  created_at timestamptz not null default now()
);

create index if not exists openings_club_idx on public.openings (club_id, created_at desc);

alter table public.openings enable row level security;

-- One application per wallet per opening. The primary key stops duplicates.
create table if not exists public.applications (
  opening_id text not null references public.openings (id),
  wallet text not null,
  status text not null default 'pending',  -- pending, accepted or declined
  created_at timestamptz not null default now(),
  primary key (opening_id, wallet)
);

alter table public.applications enable row level security;
