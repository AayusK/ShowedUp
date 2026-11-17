import { NextResponse } from "next/server";
import { authorizeClub, ownsEvent } from "@/lib/server/auth";
import { getEvent, readEvents } from "@/lib/server/events";
import { clubMembers, eventAttendees } from "@/lib/server/members";
import { getClubKeypair, type ClubRecord } from "@/lib/server/clubs";
import { isRevocable } from "@/lib/server/revoke";

/** The club's key can be worked out here (CLUB_KEY_SECRET / ORGANIZER_SECRET_KEY set). No network call. */
function clubKeyAvailable(club: ClubRecord): boolean {
  try { getClubKeypair(club); return true; } catch { return false; }
}

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
    // Whether this club can take back this badge (only badges with the club as permanent
    // delegate). Checked once per request; if Solana can't be read, the page just hides "Revoke".
    const [listed, revocable] = await Promise.all([
      event ? eventAttendees(event) : Promise.resolve([]),
      event && clubKeyAvailable(club) ? isRevocable(event, club).catch(() => false) : Promise.resolve(false),
    ]);
    let attendees = listed;
    // A contribution badge can be given to any pasted address. Show a saved name only for people
    // who checked in to one of this club's events; everyone else is a shortened wallet.
    if (event?.kind === "contribution") {
      const members = new Set((await clubMembers(await readEvents(club.id))).map((m) => m.wallet));
      attendees = attendees.map((a) => (members.has(a.wallet) ? a : { ...a, name: `${a.wallet.slice(0, 4)}…${a.wallet.slice(-4)}` }));
    }
    return NextResponse.json({ attendees, revocable }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[api/attendees] read failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
