import { NextResponse } from "next/server";
import { authorizeClub } from "@/lib/server/auth";
import { addEvent, readEvents, type EventRecord } from "@/lib/server/events";
import { newId } from "@/lib/server/ids";
import { getAttendeeCounts } from "@/lib/server/counts";
import { CLUB_ID_RE } from "@/lib/clubs";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function error(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, ...extra }, { status });
}

// Public: the event list. `?club=<id>` keeps one club's events; `?counts=1` adds attendee counts.
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const club = query.get("club");
  let events: EventRecord[];
  try {
    events = await readEvents(club && CLUB_ID_RE.test(club) ? club : undefined);
  } catch {
    return error("server_not_configured", 500);
  }
  if (query.get("counts") === "1" && events.length > 0) {
    const counts = await getAttendeeCounts(events);
    return NextResponse.json({
      events: events.map(e => ({ ...e, attendees: counts[e.id] })),
      ...(events.some(e => counts[e.id] === undefined) ? { countsUnavailable: true } : {}),
    });
  }
  return NextResponse.json({ events });
}

// New events keep attendance in Supabase. Officers confirm contributions on the event itself.
export async function POST(request: Request) {
  let club;
  try {
    club = await authorizeClub(request);
  } catch {
    return error("server_not_configured", 500);
  }
  if (!club) return error("unauthorized", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("invalid_input", 400, { message: "Body must be JSON" });
  }
  const { name, date, location, kind } = (body ?? {}) as Record<string, unknown>;
  if (kind !== undefined && kind !== "attendance") {
    return error("invalid_input", 400, { message: "Select a check-in event to confirm a contribution." });
  }

  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanLocation = typeof location === "string" ? location.trim() : "";
  if (!cleanName || cleanName.length > 80) {
    return error("invalid_input", 400, { message: "Event name is required (max 80 characters)" });
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return error("invalid_input", 400, { message: "Date and time are required" });
  }
  if (cleanLocation.length > 80) {
    return error("invalid_input", 400, { message: "Location is too long (max 80 characters)" });
  }

  const event: EventRecord = {
    id: newId(),
    name: cleanName,
    date,
    ...(cleanLocation ? { location: cleanLocation } : {}),
    mint: null,
    createdAt: new Date().toISOString(),
    ...(club.legacy ? {} : { clubId: club.id }),
  };
  try {
    await addEvent(event);
    return NextResponse.json({ event }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && /null value in column "mint"/.test(e.message)) return error("schema_not_ready", 503);
    return error("save_failed", 500);
  }
}
