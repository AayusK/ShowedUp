import "server-only";
import { db } from "./db";
import { LEGACY_CLUB_ID } from "@/lib/clubs";
import { readKindAndRole, type BadgeKind, type Role } from "@/lib/badges";

export interface EventRecord {
  id: string;
  name: string;
  /** Local wall-clock time "YYYY-MM-DDTHH:mm" (no timezone), as the organizer entered it. */
  date: string;
  location?: string;
  mint: string | null;
  createdAt: string;
  /** The club that issued this event's badge. Absent = the default club (older events). */
  clubId?: string;
  /** Absent = "attendance" (claimed with the QR code). "contribution" badges are awarded by an officer. */
  kind?: BadgeKind;
  /** Only for contribution badges: Volunteer, Speaker, Mentor, Organizer or Officer. */
  role?: Role;
}

interface EventRow {
  id: string;
  name: string;
  starts_at: string; // Postgres `timestamp` comes back as "YYYY-MM-DDTHH:mm:ss"
  location: string | null;
  mint: string | null;
  created_at: string;
  club_id?: string | null;
  kind?: string | null;
  role?: string | null;
}

// The columns from before clubs existed, and the ones db/01_clubs.sql and db/02_role_badges.sql add.
const BASE_COLUMNS = "id, name, starts_at, location, mint, created_at";
const CLUB_COLUMNS = `${BASE_COLUMNS}, club_id`;
const COLUMNS = `${CLUB_COLUMNS}, kind, role`;
// Postgres / PostgREST codes for "that column doesn't exist": the new SQL hasn't been run yet.
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);

/**
 * Reads with the newest columns first, then steps back one SQL file at a time. Stepping back in
 * stages matters: if db/02 hasn't been run yet, we must still read `club_id` (from db/01), or
 * every club's event would look like the default club's.
 */
async function selectWithFallback<T>(run: (columns: string) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>) {
  let result = await run(COLUMNS);
  for (const columns of [CLUB_COLUMNS, BASE_COLUMNS]) {
    if (!result.error || !MISSING_COLUMN.has(result.error.code ?? "")) break;
    result = await run(columns);
  }
  return result;
}

function fromRow(r: EventRow): EventRecord {
  const { kind, role } = readKindAndRole(r.kind, r.role);
  return {
    id: r.id,
    name: r.name,
    date: r.starts_at.slice(0, 16),
    ...(r.location ? { location: r.location } : {}),
    mint: r.mint,
    createdAt: r.created_at,
    ...(r.club_id && r.club_id !== LEGACY_CLUB_ID ? { clubId: r.club_id } : {}),
    ...(kind === "contribution" ? { kind, role } : {}),
  };
}

/** Every event, newest first. Pass a club id to get only that club's events. */
export async function readEvents(clubId?: string): Promise<EventRecord[]> {
  const { data, error } = await selectWithFallback((columns) =>
    db().from("events").select(columns).order("starts_at", { ascending: false }));
  if (error) throw new Error(`events read failed: ${error.message}`);
  const events = (data as unknown as EventRow[]).map(fromRow);
  return clubId ? events.filter((e) => (e.clubId ?? LEGACY_CLUB_ID) === clubId) : events;
}

export async function getEvent(id: string): Promise<EventRecord | null> {
  if (!/^[a-z0-9]{8}$/.test(id)) return null;
  const { data, error } = await selectWithFallback((columns) =>
    db().from("events").select(columns).eq("id", id).maybeSingle());
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
    ...(event.kind === "contribution" && event.role ? { kind: event.kind, role: event.role } : {}),
  });
  if (error) throw new Error(`event insert failed: ${error.message}`);
}
