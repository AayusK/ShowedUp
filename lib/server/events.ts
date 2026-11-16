import "server-only";
import { db } from "./db";

export interface EventRecord {
  id: string;
  name: string;
  /** Local wall-clock time "YYYY-MM-DDTHH:mm" (no timezone), as the organizer entered it. */
  date: string;
  location?: string;
  mint: string;
  createdAt: string;
}

interface EventRow {
  id: string;
  name: string;
  starts_at: string; // Postgres `timestamp` comes back as "YYYY-MM-DDTHH:mm:ss"
  location: string | null;
  mint: string;
  created_at: string;
}

const COLUMNS = "id, name, starts_at, location, mint, created_at";

function fromRow(r: EventRow): EventRecord {
  return {
    id: r.id,
    name: r.name,
    date: r.starts_at.slice(0, 16),
    ...(r.location ? { location: r.location } : {}),
    mint: r.mint,
    createdAt: r.created_at,
  };
}

export async function readEvents(): Promise<EventRecord[]> {
  const { data, error } = await db().from("events").select(COLUMNS).order("starts_at", { ascending: false });
  if (error) throw new Error(`events read failed: ${error.message}`);
  return (data as EventRow[]).map(fromRow);
}

export async function getEvent(id: string): Promise<EventRecord | null> {
  if (!/^[a-z0-9]{8}$/.test(id)) return null;
  const { data, error } = await db().from("events").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`event read failed: ${error.message}`);
  return data ? fromRow(data as EventRow) : null;
}

export async function addEvent(event: EventRecord): Promise<void> {
  const { error } = await db().from("events").insert({
    id: event.id,
    name: event.name,
    starts_at: event.date,
    location: event.location ?? null,
    mint: event.mint,
    created_at: event.createdAt,
  });
  if (error) throw new Error(`event insert failed: ${error.message}`);
}
