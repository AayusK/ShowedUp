import { NextResponse } from "next/server";
import { authorizeClub, ownsEvent } from "@/lib/server/auth";
import { getEvent } from "@/lib/server/events";
import { currentCode } from "@/lib/server/code";

export const dynamic = "force-dynamic";

// The organizer screen polls this for the code to put in the QR.
// Needs the passcode of the club that owns the event, so attendees (and other clubs) can't
// fetch codes without being in the room.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const club = await authorizeClub(request);
    if (!club) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const event = await getEvent(id);
    if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!ownsEvent(club, event)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    // Contribution badges are awarded by an officer; they have no QR code to scan.
    if (event.kind === "contribution") return NextResponse.json({ error: "not_checkin_event" }, { status: 400 });
    return NextResponse.json(currentCode(event.id), { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "code_not_configured" }, { status: 500 });
  }
}
