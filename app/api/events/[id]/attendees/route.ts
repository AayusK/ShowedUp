import { NextResponse } from "next/server";
import { authorizeClub, ownsEvent } from "@/lib/server/auth";
import { getEvent } from "@/lib/server/events";
import { eventAttendees } from "@/lib/server/members";

export const dynamic = "force-dynamic";

// The check-in screen polls this for its "Who's here" list. Needs the passcode of the club
// that owns the event: names are only for that club's officers.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const club = await authorizeClub(request);
    if (!club) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const event = await getEvent(id);
    // Another club's event answers the same as a wrong passcode.
    if (event && !ownsEvent(club, event)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const attendees = event ? await eventAttendees(event) : [];
    return NextResponse.json({ attendees }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[api/attendees] read failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
