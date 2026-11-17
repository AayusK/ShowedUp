import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getEvent } from "@/lib/server/events";
import { confirmClaim, recordExistingClaim, releaseClaim, reserveClaim } from "@/lib/server/claimsDb";
import { isValidCode } from "@/lib/server/code";
import { hasClaimed, mintAttendance, verifyWalletSignature } from "@/lib/server/claim";
import { claimMessage } from "@/lib/claimMessage";
import { OrganizerUnfundedError } from "@/lib/server/mint";
import { eventClubId } from "@/lib/server/auth";
import { ClubKeyError, getClub, getClubKeypair } from "@/lib/server/clubs";
import { hasMemberName, saveMemberName } from "@/lib/server/members";
import { cleanName } from "@/lib/memberName";

export const dynamic = "force-dynamic";

function error(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return error("invalid_input", 400);
  }
  const { eventId, wallet, code, signature } = body;
  if (typeof eventId !== "string" || typeof wallet !== "string" || typeof code !== "string" || typeof signature !== "string") {
    return error("invalid_input", 400);
  }

  let owner: PublicKey;
  try {
    owner = new PublicKey(wallet);
    // A real wallet address is a point on the Ed25519 curve (program-derived addresses aren't).
    if (!PublicKey.isOnCurve(owner.toBytes())) return error("invalid_wallet", 400);
  } catch {
    return error("invalid_wallet", 400);
  }

  // 1. The event exists and the code is current (or from the previous 30 s window).
  let event;
  try {
    event = await getEvent(eventId);
  } catch {
    return error("server_not_configured", 500);
  }
  if (!event) return error("not_found", 404);
  const normalizedCode = code.trim().toUpperCase();
  try {
    if (!isValidCode(event.id, normalizedCode)) return NextResponse.json({ status: "expired" });
  } catch {
    return error("server_not_configured", 500);
  }

  // 2. The claimer controls this wallet: they signed the exact claim message with it.
  const message = claimMessage(event.id, normalizedCode, owner.toBase58());
  if (!verifyWalletSignature(owner.toBase58(), message, signature)) return error("bad_signature", 401);

  const wallet58 = owner.toBase58();

  // 3. The attendee's display name: saved (or updated) only after the wallet signature checks
  //    out, so nobody can set a name for someone else's wallet. Asked for once per wallet.
  const name = cleanName(body.name);
  try {
    if (name) await saveMemberName(wallet58, name);
    else if (!(await hasMemberName(wallet58))) return error("name_required", 400);
  } catch (e) {
    console.error("[api/claim] name save failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("server_error", 500);
  }

  let reserved = false;
  try {
    const mint = new PublicKey(event.mint);

    // 4. One token per wallet per event. The chain is the source of truth.
    if (await hasClaimed(mint, owner)) {
      await recordExistingClaim(event.id, wallet58).catch(() => {});
      return NextResponse.json({ status: "already_claimed" });
    }

    // 5. Take the (event, wallet) lock in the database so a double-tap, or two server
    //    instances, can't both mint.
    const reservation = await reserveClaim(event.id, wallet58);
    if (reservation === "in_progress") return error("in_progress", 409);
    if (reservation === "confirmed") return NextResponse.json({ status: "already_claimed" });
    reserved = true;

    // 6. Create the attendee's token account if needed and mint 1. The organizer wallet pays;
    //    the club that owns the event signs as the badge's issuer.
    const club = await getClub(eventClubId(event));
    if (!club) throw new ClubKeyError("This event's club no longer exists");
    const txSignature = await mintAttendance(mint, owner, getClubKeypair(club));
    await confirmClaim(event.id, wallet58, txSignature);
    reserved = false;
    return NextResponse.json({ status: "success", signature: txSignature });
  } catch (e) {
    if (e instanceof OrganizerUnfundedError) return error("organizer_unfunded", 503);
    if (e instanceof ClubKeyError) return error("server_not_configured", 500);
    if (e instanceof Error && /ORGANIZER_SECRET_KEY|SUPABASE_/.test(e.message)) return error("server_not_configured", 500);
    console.error("[api/claim] claim failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("rpc_error", 502);
  } finally {
    // If minting failed, free the lock so the attendee can retry.
    if (reserved) await releaseClaim(event.id, wallet58).catch(() => {});
  }
}
