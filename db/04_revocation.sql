-- Revocation (track-record build, wave B). Run once in the Supabase SQL editor; safe to run again.
-- When a club takes back a badge it issued by mistake, the token is burned on Solana and the
-- time is noted here. Empty = not revoked, so every existing row keeps working.

alter table public.claims add column if not exists revoked_at timestamptz;
