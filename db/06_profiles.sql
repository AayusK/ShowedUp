-- Public profiles (2026-11-20). Run once in the Supabase SQL editor; safe to run again.
-- A student can add a name, headline, school, bio, links and skills to their track record.
-- It stays hidden until they switch "Show on my track record" on (is_public). Saving needs a
-- signature from the wallet, checked on the server. Nothing here goes on-chain.
-- RLS stays on with no policies: only the server's secret key reads or writes this table.

create table if not exists public.profiles (
  wallet text primary key,
  display_name text,
  headline text,
  school text,
  major text,
  grad_year integer,
  bio text,
  links jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  is_public boolean not null default false,
  signed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
