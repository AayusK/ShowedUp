import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { isOrganizerAuthorized } from "@/lib/server/auth";
import { addEvent, readEvents, type EventRecord } from "@/lib/server/events";
import { OrganizerUnfundedError, createEventMint } from "@/lib/server/mint";
import { getAttendeeCounts } from "@/lib/server/counts";

export const dynamic = "force-dynamic";

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function newId(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

function error(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, ...extra }, { status });
}

export async function GET(request: Request) {
  let events: EventRecord[];
  try {
    events = await readEvents();
  } catch {
    return error("server_not_configured", 500);
  }
  // ?counts=1 adds on-chain attendee counts. If devnet is unreachable, still return the list.
  if (new URL(request.url).searchParams.get("counts") === "1" && events.length > 0) {
    try {
      const counts = await getAttendeeCounts(events.map((e) => e.mint));
      return NextResponse.json({ events: events.map((e) => ({ ...e, attendees: counts[e.mint] ?? 0 })) });
    } catch {
      return NextResponse.json({ events, countsUnavailable: true });
    }
  }
  return NextResponse.json({ events });
}

export async function POST(request: Request) {
  if (!isOrganizerAuthorized(request)) return error("unauthorized", 401);

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

  let mint: string;
  let signature: string;
  try {
    ({ mint, signature } = await createEventMint());
  } catch (e) {
    if (e instanceof OrganizerUnfundedError) {
      return error("organizer_unfunded", 503, { organizer: e.organizer });
    }
    if (e instanceof Error && /ORGANIZER_SECRET_KEY|SUPABASE_/.test(e.message)) {
      return error("organizer_not_configured", 500);
    }
    console.error("[api/events] mint creation failed:", e instanceof Error ? e.message : "unknown");
    return error("rpc_error", 502);
  }

  const existing = new Set((await readEvents()).map((e) => e.id));
  let id = newId();
  while (existing.has(id)) id = newId();

  const event: EventRecord = {
    id,
    name: cleanName,
    date,
    ...(cleanLocation ? { location: cleanLocation } : {}),
    mint,
    createdAt: new Date().toISOString(),
  };
  try {
    await addEvent(event);
  } catch (e) {
    console.error("[api/events] saving event failed:", e instanceof Error ? e.message : "unknown");
    return error("save_failed", 500);
  }

  return NextResponse.json({ event, signature }, { status: 201 });
}
