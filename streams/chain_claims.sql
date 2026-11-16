-- Run once in the Supabase SQL editor (README, "Live claim feed").
-- Claims as seen on-chain, pushed to ShowedUp by a QuickNode Stream: one row per mint transaction.
-- Row-level security is on with no policies, so only the server's secret key can read or write.

create table if not exists public.chain_claims (
  signature text primary key,
  mint text not null,
  wallet text not null,
  block_height bigint,
  block_time timestamptz,
  received_at timestamptz not null default now()
);

create index if not exists chain_claims_mint_time_idx on public.chain_claims (mint, block_time desc);

alter table public.chain_claims enable row level security;
