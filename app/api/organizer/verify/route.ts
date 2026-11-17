import { NextResponse } from "next/server";
import { authorizeClub } from "@/lib/server/auth";
import { clubInfo } from "@/lib/server/clubs";

// Lets the organizer page check a club's passcode before showing organizer actions.
// `admin` is true for the default club, whose passcode is also the registry admin password.
export async function POST(request: Request) {
  try {
    const club = await authorizeClub(request);
    if (!club) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: true, club: clubInfo(club), admin: club.legacy });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
