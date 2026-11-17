-- Step 2 of the track-record build. Run once in the Supabase SQL editor; safe to run again.
-- Badges can now record what someone did, not only that they were present.
-- Empty values mean a plain attendance badge, so every existing event keeps working.

alter table public.events add column if not exists kind text;  -- 'attendance' or 'contribution'
alter table public.events add column if not exists role text;  -- Attendee, Volunteer, Speaker, Mentor, Organizer or Officer
