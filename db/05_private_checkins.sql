-- Private check-ins and one club-signed contribution receipt per event, wallet and role.
-- Run after db/01 through db/04. Existing event mints and claims are preserved.
begin;

alter table public.events alter column mint drop not null;

create table if not exists public.contribution_receipts (
  event_id text not null,
  wallet text not null,
  role text not null check (role in ('Volunteer', 'Speaker', 'Mentor', 'Organizer', 'Officer')),
  receipt_file jsonb not null,
  signature text generated always as (receipt_file->'receipt'->>'signature') stored not null unique,
  signed_transaction text,
  last_valid_block_height bigint not null,
  confirmed_at timestamptz,
  streamed_at timestamptz,
  primary key (event_id, wallet, role),
  foreign key (event_id, wallet) references public.claims (event_id, wallet),
  check (confirmed_at is not null or signed_transaction is not null)
);

alter table public.contribution_receipts enable row level security;
revoke all on public.contribution_receipts from public, anon, authenticated;
grant select, insert, update on public.contribution_receipts to service_role;
create index if not exists contribution_receipts_wallet_idx
  on public.contribution_receipts (wallet) where confirmed_at is not null;
create index if not exists contribution_receipts_feed_idx
  on public.contribution_receipts (streamed_at desc) where streamed_at is not null;

-- Count in Postgres so the PostgREST page size does not cap the attendee total.
create or replace function public.private_checkin_counts(event_ids text[])
returns table (event_id text, attendees bigint)
language sql stable security invoker set search_path = '' as $$
  select c.event_id, count(*) from public.claims c
  join public.events e on e.id = c.event_id
  where c.event_id = any(event_ids) and e.mint is null
    and c.status = 'confirmed' and c.revoked_at is null
  group by c.event_id;
$$;
revoke all on function public.private_checkin_counts(text[]) from public, anon, authenticated;
grant execute on function public.private_checkin_counts(text[]) to service_role;
notify pgrst, 'reload schema';
commit;
