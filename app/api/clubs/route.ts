import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/server/auth";
import { ClubKeyError, ClubNameTakenError, clubInfo, createClub, legacyClub, readClubs } from "@/lib/server/clubs";
import { CLUB_NAME_MAX, PASSCODE_MIN, cleanClubName, isValidPasscode } from "@/lib/clubs";

export const dynamic = "force-dynamic";

function error(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, ...extra }, { status });
}

// Public: the list of clubs (name, issuer address, verified or not). Nothing here is secret:
// a club's name and issuer address are on the chain in every badge it hands out.
export async function GET() {
  try {
    return NextResponse.json({ clubs: (await readClubs()).map(clubInfo) }, { headers: { "cache-control": "no-store" } });
  } catch {
    // The database is unreachable. The default club still exists, so signing in to it keeps working.
    return NextResponse.json({ clubs: [clubInfo(legacyClub())], partial: true }, { headers: { "cache-control": "no-store" } });
  }
}

// Registry admin only (ORGANIZER_PASSWORD): create a club. The club's Solana address is derived
// from CLUB_KEY_SECRET and the new club id; no key is stored.
// Creating a club. The registry admin (admin password) can create verified clubs. Anyone else can
// sign a club up, but it always starts unverified: it can sign in and look around, and creating
// events or badges (which spends the organizer wallet's SOL) unlocks once the admin verifies it.
const MAX_PENDING_CLUBS = 50;

export async function POST(request: Request) {
  const admin = isAdminAuthorized(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("invalid_input", 400, { message: "Body must be JSON" });
  }
  const { name, passcode, verified } = (body ?? {}) as Record<string, unknown>;
  const cleanName = cleanClubName(name);
  if (!cleanName) return error("invalid_input", 400, { message: `Club name is required (max ${CLUB_NAME_MAX} characters)` });
  if (!isValidPasscode(passcode)) {
    return error("invalid_input", 400, { message: `The passcode needs at least ${PASSCODE_MIN} characters (letters, numbers and symbols)` });
  }

  try {
    if (!admin) {
      // A brake on spam sign-ups: stop taking new ones while too many wait for the admin.
      const pending = (await readClubs()).filter((c) => !c.legacy && !c.verified).length;
      if (pending >= MAX_PENDING_CLUBS) return error("too_many_pending", 429);
    }
    const club = await createClub(cleanName, passcode, admin && verified === true);
    return NextResponse.json({ club: clubInfo(club) }, { status: 201 });
  } catch (e) {
    if (e instanceof ClubNameTakenError) return error("name_taken", 409);
    if (e instanceof ClubKeyError) return error("club_key_not_configured", 500);
    console.error("[api/clubs] creating club failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("save_failed", 500);
  }
}
