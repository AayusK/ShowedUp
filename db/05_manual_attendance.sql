-- Manual attendance (2026-11-20). Run once in the Supabase SQL editor; safe to run again.
-- An officer can add someone who missed the QR scan. Those claims are marked here, so:
--  - the check-in list can show "Added by officer", and
--  - pasting a stranger's wallet never makes them a "member" of the club, so the club never
--    sees a name that person saved while checking in somewhere else.
-- Existing rows get false: they were all claimed by the attendee themselves.

alter table public.claims add column if not exists added_by_officer boolean not null default false;
