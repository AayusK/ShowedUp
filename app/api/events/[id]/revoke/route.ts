import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { authorizeClub, ownsEvent } from "@/lib/server/auth";
import { ClubKeyError } from "@/lib/server/clubs";
import { getEvent } from "@/lib/server/events";
import { OrganizerUnfundedError } from "@/lib/server/mint";
import { revokeBadge } from "@/lib/server/revoke";

export const dynamic = "force-dynamic";

function error(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, ...extra }, { status });
}

// An officer takes back a badge their club issued by mistake. The club's key burns the
// student's token on Solana (as the badge's permanent delegate). Body: { wallet }.
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

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return error("bad_wallet", 400);
  }
  let owner: PublicKey;
  try {
    if (typeof body.wallet !== "string") throw new Error();
    owner = new PublicKey(body.wallet.trim());
  } catch {
    return error("bad_wallet", 400);
  }

  try {
    const result = await revokeBadge(event, club, owner);
    if (result.status === "not_revocable") return error("not_revocable", 409);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof OrganizerUnfundedError) return error("organizer_unfunded", 503, { organizer: e.organizer });
    if (e instanceof ClubKeyError) return error("club_key_not_configured", 500);
    if (e instanceof Error && /ORGANIZER_SECRET_KEY|SUPABASE_/.test(e.message)) return error("server_not_configured", 500);
    console.error("[api/revoke] revoke failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("rpc_error", 502);
  }
}
