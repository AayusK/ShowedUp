import { NextResponse } from "next/server";
import { authorizeClub } from "@/lib/server/auth";
import { ClubKeyError, getClubKeypair } from "@/lib/server/clubs";
import { addEvent, readEvents, type EventRecord } from "@/lib/server/events";
import { newId } from "@/lib/server/ids";
import { BadgeTooLargeError, OrganizerUnfundedError, createEventMint } from "@/lib/server/mint";
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
  // ?counts=1 adds on-chain attendee counts. If devnet is unreachable, still return the list.
  if (query.get("counts") === "1" && events.length > 0) {
    try {
      const counts = await getAttendeeCounts(events.map((e) => e.mint));
      return NextResponse.json({ events: events.map((e) => ({ ...e, attendees: counts[e.mint] ?? 0 })) });
    } catch {
      return NextResponse.json({ events, countsUnavailable: true });
    }
  }
  return NextResponse.json({ events });
}

// A club's officer creates an event. Needs that club's passcode; the badge is issued from that
// club's wallet.
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
  const { name, date, location } = (body ?? {}) as Record<string, unknown>;

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

  // The id comes first now: the token's address on Solana is derived from it.
  let id: string;
  try {
    const existing = new Set((await readEvents()).map((e) => e.id));
    id = newId();
    while (existing.has(id)) id = newId();
  } catch {
    return error("server_not_configured", 500);
  }

  let mint: string;
  let signature: string;
  try {
    ({ mint, signature } = await createEventMint(
      { id, name: cleanName, date, ...(cleanLocation ? { location: cleanLocation } : {}) },
      getClubKeypair(club),
    ));
  } catch (e) {
    if (e instanceof OrganizerUnfundedError) {
      return error("organizer_unfunded", 503, { organizer: e.organizer });
    }
    if (e instanceof BadgeTooLargeError) {
      return error("invalid_input", 400, { message: "The name and location are too long to store on Solana. Shorten them (emoji count for several characters)." });
    }
    if (e instanceof ClubKeyError) return error("club_key_not_configured", 500);
    if (e instanceof Error && /ORGANIZER_SECRET_KEY|SUPABASE_/.test(e.message)) {
      return error("organizer_not_configured", 500);
    }
    console.error("[api/events] mint creation failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("rpc_error", 502);
  }

  const event: EventRecord = {
    id,
    name: cleanName,
    date,
    ...(cleanLocation ? { location: cleanLocation } : {}),
    mint,
    createdAt: new Date().toISOString(),
    ...(club.legacy ? {} : { clubId: club.id }),
  };
  try {
    await addEvent(event);
  } catch (e) {
    console.error("[api/events] saving event failed:", e instanceof Error ? e.message : "unknown");
    return error("save_failed", 500);
  }

  return NextResponse.json({ event, signature }, { status: 201 });
}
