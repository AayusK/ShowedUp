import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { authorizeClub, ownsEvent } from "@/lib/server/auth";
import { awardBadge } from "@/lib/server/awards";
import { ClubKeyError } from "@/lib/server/clubs";
import { getEvent } from "@/lib/server/events";
import { OrganizerUnfundedError } from "@/lib/server/mint";

export const dynamic = "force-dynamic";

function error(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, ...extra }, { status });
}

// An officer awards a contribution badge to one wallet. Needs the passcode of the club that
// owns the badge. One recipient per request, so the page can show progress and a slow Solana
// confirmation for one person never times out the rest.
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
  // Another club's badge answers the same as a wrong passcode.
  if (!ownsEvent(club, event)) return error("unauthorized", 401);
  // Attendance is only ever claimed in the room with the QR code.
  if (event.kind !== "contribution") return error("not_contribution", 400);

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
    const result = await awardBadge(event, club, owner);
    if (result.status === "in_progress") return error("in_progress", 409);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof OrganizerUnfundedError) return error("organizer_unfunded", 503, { organizer: e.organizer });
    if (e instanceof ClubKeyError) return error("club_key_not_configured", 500);
    if (e instanceof Error && /ORGANIZER_SECRET_KEY|SUPABASE_/.test(e.message)) return error("server_not_configured", 500);
    console.error("[api/award] award failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("rpc_error", 502);
  }
}
