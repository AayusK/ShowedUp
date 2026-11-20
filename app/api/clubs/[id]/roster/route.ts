import { NextResponse } from "next/server";
import { authorizeClub } from "@/lib/server/auth";
import { readEvents } from "@/lib/server/events";
import { clubRoster } from "@/lib/server/members";

export const dynamic = "force-dynamic";

// The dashboard's Members tab: everyone holding a badge from this club, most active first.
// Read-only. Needs this club's passcode: names are only for that club's officers.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const club = await authorizeClub(request);
    // The passcode must be for the club in the URL.
    if (!club || club.id !== id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const roster = await clubRoster(await readEvents(club.id));
    return NextResponse.json({ roster }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[api/clubs/roster] read failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
