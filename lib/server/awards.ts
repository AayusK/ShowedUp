import "server-only";
import { PublicKey } from "@solana/web3.js";
import { hasClaimed, mintAttendance } from "./claim";
import { confirmClaim, recordExistingClaim, releaseClaim, reserveClaim } from "./claimsDb";
import { getClubKeypair, type ClubRecord } from "./clubs";
import type { EventRecord } from "./events";

export type AwardResult =
  | { status: "awarded"; signature: string }
  | { status: "already_awarded" }
  | { status: "in_progress" };

/**
 * An officer gives one person a contribution badge (e.g. "Mentor"). Same on-chain steps as a
 * claim: create the person's token account if needed and mint exactly 1 token; the organizer
 * wallet pays and the club's key signs as the issuer. No QR code and no signature from the
 * recipient: the club is the one acting here, and a badge is only ever a positive record.
 * The (event, wallet) row in `claims` is the lock, so a double click, or two server instances,
 * can't mint twice.
 */
export async function awardBadge(event: EventRecord, club: ClubRecord, owner: PublicKey, opts: { addedByOfficer?: boolean } = {}): Promise<AwardResult> {
  const mint = new PublicKey(event.mint);
  const wallet = owner.toBase58();

  // One badge per person. The chain is the source of truth.
  if (await hasClaimed(mint, owner)) {
    await recordExistingClaim(event.id, wallet).catch(() => {});
    return { status: "already_awarded" };
  }

  const reservation = await reserveClaim(event.id, wallet, opts);
  if (reservation === "in_progress") return { status: "in_progress" };
  if (reservation === "confirmed") return { status: "already_awarded" };

  let reserved = true;
  try {
    const signature = await mintAttendance(mint, owner, getClubKeypair(club));
    await confirmClaim(event.id, wallet, signature);
    reserved = false;
    return { status: "awarded", signature };
  } finally {
    // If minting failed, free the lock so the officer can try again.
    if (reserved) await releaseClaim(event.id, wallet).catch(() => {});
  }
}
