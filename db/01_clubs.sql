-- Step 1 of the track-record build. Run once in the Supabase SQL editor; safe to run again.
-- Clubs that can issue badges. Each club's Solana key is derived on the server from
-- CLUB_KEY_SECRET and the club id, so no key is stored here: `issuer` is only the public address.
-- Row-level security is on with no policies, so only the server's secret key can read or write.

create table if not exists public.clubs (
  id text primary key,
  name text not null,
  issuer text not null,
  -- "scrypt$<salt>$<hash>". Empty only for the default club, whose passcode is ORGANIZER_PASSWORD.
  passcode_hash text,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists clubs_issuer_idx on public.clubs (issuer);
create unique index if not exists clubs_name_idx on public.clubs (lower(name));

alter table public.clubs enable row level security;

-- Which club an event belongs to. Empty = the default club (every event from before clubs existed).
alter table public.events add column if not exists club_id text references public.clubs (id);

create index if not exists events_club_idx on public.events (club_id);
