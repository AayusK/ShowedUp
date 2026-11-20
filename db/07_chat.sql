-- Club chat (2026-11-20). Run once in the Supabase SQL editor; safe to run again.
-- Each club has an "Everyone" group plus groups its officers create for a job. Officers sign in
-- with the club passcode; members (people who checked in to the club themselves) sign in with a
-- wallet signature. Only the server reads or writes these tables (RLS on, no policies).

create table if not exists public.chat_groups (
  id text primary key,
  club_id text not null,
  name text not null,
  purpose text,
  is_everyone boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists chat_groups_club on public.chat_groups (club_id);
-- At most one "Everyone" group per club.
create unique index if not exists chat_groups_one_everyone on public.chat_groups (club_id) where is_everyone;

create table if not exists public.chat_group_members (
  group_id text not null references public.chat_groups (id) on delete cascade,
  wallet text not null,
  added_at timestamptz not null default now(),
  primary key (group_id, wallet)
);
create index if not exists chat_group_members_wallet on public.chat_group_members (wallet);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  group_id text not null references public.chat_groups (id) on delete cascade,
  author_kind text not null check (author_kind in ('officer', 'member')),
  author_wallet text,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_group on public.chat_messages (group_id, id);

alter table public.chat_groups enable row level security;
alter table public.chat_group_members enable row level security;
alter table public.chat_messages enable row level security;
