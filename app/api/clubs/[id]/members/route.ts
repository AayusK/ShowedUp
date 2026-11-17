import { NextResponse } from "next/server";
import { authorizeClub } from "@/lib/server/auth";
import { readEvents } from "@/lib/server/events";
import { clubMembers } from "@/lib/server/members";

export const dynamic = "force-dynamic";

// The people an officer can pick from when awarding a contribution: everyone who has checked
// in to this club's events, with their saved names. Needs this club's passcode: names are only
// for the officers of a club the person actually showed up to.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const club = await authorizeClub(request);
    // The passcode must be for the club in the URL.
    if (!club || club.id !== id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const members = await clubMembers(await readEvents(club.id));
    return NextResponse.json({ members }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[api/clubs/members] read failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
