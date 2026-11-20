import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { authorizeClub, ownsEvent } from "@/lib/server/auth";
import { awardBadge } from "@/lib/server/awards";
import { supportsOfficerAdds } from "@/lib/server/claimsDb";
import { ClubKeyError } from "@/lib/server/clubs";
import { getEvent } from "@/lib/server/events";
import { OrganizerUnfundedError } from "@/lib/server/mint";

export const dynamic = "force-dynamic";

function error(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, ...extra }, { status });
}

// An officer adds someone who missed the QR scan to an event's attendance. Needs the passcode of
// the club that owns the event. Mints the same attendance badge a scan would (organizer pays,
// the club's key signs as issuer) and marks the claim as added by an officer.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let club;
  let event;
  try {
    club = await authorizeClub(request);
    if (!club) return error("unauthorized", 401);
    event = await getEvent(id);
  } catch {
    return error("server_not_configured", 500);
  }
  if (!event) return error("not_found", 404);
  // Another club's event answers the same as a wrong passcode.
  if (!ownsEvent(club, event)) return error("unauthorized", 401);
  // Role badges have their own "Award" flow; this is for attendance only.
  if (event.kind === "contribution") return error("not_attendance", 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return error("invalid_input", 400);
  }
  if (typeof body.wallet !== "string") return error("invalid_input", 400);

  let owner: PublicKey;
  try {
    owner = new PublicKey(body.wallet.trim());
    // A real wallet address is a point on the Ed25519 curve (program-derived addresses aren't).
    if (!PublicKey.isOnCurve(owner.toBytes())) return error("invalid_wallet", 400);
  } catch {
    return error("invalid_wallet", 400);
  }

  try {
    // Without db/05_manual_attendance.sql the "added by officer" mark can't be saved, and the
    // person's saved name could show to this club. Refuse before anything is minted.
    if (!(await supportsOfficerAdds())) return error("schema_not_ready", 503);
    const result = await awardBadge(event, club, owner, { addedByOfficer: true });
    if (result.status === "in_progress") return error("in_progress", 409);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof OrganizerUnfundedError) return error("organizer_unfunded", 503, { organizer: e.organizer });
    if (e instanceof ClubKeyError) return error("club_key_not_configured", 500);
    if (e instanceof Error && /ORGANIZER_SECRET_KEY|SUPABASE_/.test(e.message)) return error("server_not_configured", 500);
    console.error("[api/attendance] add failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("rpc_error", 502);
  }
}
