import "server-only";
import { db } from "./db";
import { LEGACY_CLUB_ID } from "@/lib/clubs";

export interface EventRecord {
  id: string;
  name: string;
  /** Local wall-clock time "YYYY-MM-DDTHH:mm" (no timezone), as the organizer entered it. */
  date: string;
  location?: string;
  mint: string;
  createdAt: string;
  /** The club that issued this event's badge. Absent = the default club (older events). */
  clubId?: string;
}

interface EventRow {
  id: string;
  name: string;
  starts_at: string; // Postgres `timestamp` comes back as "YYYY-MM-DDTHH:mm:ss"
  location: string | null;
  mint: string;
  created_at: string;
  club_id?: string | null;
}

// The columns from before clubs existed, and the ones db/01_clubs.sql adds.
const BASE_COLUMNS = "id, name, starts_at, location, mint, created_at";
const COLUMNS = `${BASE_COLUMNS}, club_id`;
// Postgres / PostgREST codes for "that column doesn't exist": the new SQL hasn't been run yet.
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);

function fromRow(r: EventRow): EventRecord {
  return {
    id: r.id,
    name: r.name,
    date: r.starts_at.slice(0, 16),
    ...(r.location ? { location: r.location } : {}),
    mint: r.mint,
    createdAt: r.created_at,
    ...(r.club_id && r.club_id !== LEGACY_CLUB_ID ? { clubId: r.club_id } : {}),
  };
}

/** Every event, newest first. Pass a club id to get only that club's events. */
export async function readEvents(clubId?: string): Promise<EventRecord[]> {
  const run = (columns: string) => db().from("events").select(columns).order("starts_at", { ascending: false });
  let { data, error } = await run(COLUMNS);
  // Before db/01_clubs.sql is run there is no club_id column: every event is the default club's.
  if (error && MISSING_COLUMN.has(error.code ?? "")) ({ data, error } = await run(BASE_COLUMNS));
  if (error) throw new Error(`events read failed: ${error.message}`);
  const events = (data as unknown as EventRow[]).map(fromRow);
  return clubId ? events.filter((e) => (e.clubId ?? LEGACY_CLUB_ID) === clubId) : events;
}

export async function getEvent(id: string): Promise<EventRecord | null> {
  if (!/^[a-z0-9]{8}$/.test(id)) return null;
  const run = (columns: string) => db().from("events").select(columns).eq("id", id).maybeSingle();
  let { data, error } = await run(COLUMNS);
  if (error && MISSING_COLUMN.has(error.code ?? "")) ({ data, error } = await run(BASE_COLUMNS));
  if (error) throw new Error(`event read failed: ${error.message}`);
  return data ? fromRow(data as unknown as EventRow) : null;
}

export async function addEvent(event: EventRecord): Promise<void> {
  const { error } = await db().from("events").insert({
    id: event.id,
    name: event.name,
    starts_at: event.date,
    location: event.location ?? null,
    mint: event.mint,
    created_at: event.createdAt,
    // Left out for the default club, so its events save the same way they always have.
    ...(event.clubId && event.clubId !== LEGACY_CLUB_ID ? { club_id: event.clubId } : {}),
  });
  if (error) throw new Error(`event insert failed: ${error.message}`);
}
