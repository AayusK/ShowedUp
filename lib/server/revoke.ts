import "server-only";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
  createBurnInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getPermanentDelegate,
} from "@solana/spl-token";
import { markRevoked } from "./claimsDb";
import { getClubKeypair, type ClubRecord } from "./clubs";
import type { EventRecord } from "./events";
import { getOrganizerKeypair } from "./organizer";
import { OrganizerUnfundedError, getConnection, uniqueSigners, withRetry } from "./mint";

// Taking back a badge a club issued by mistake. Every badge created since clubs existed names
// the issuing club as its "permanent delegate": an address the token program lets burn (destroy)
// that badge from any holder's account. Older badges have no permanent delegate and can't be taken back.

// Two signatures at 5,000 lamports each, with room to spare.
const FEE_BUFFER_LAMPORTS = 10_000;

export type RevokeResult =
  | { status: "revoked"; signature: string }
  | { status: "not_held" }
  | { status: "not_revocable" };

/**
 * True if this club can take back this badge: the mint's permanent delegate (set once, when the
 * mint was created, and never changeable) is the club's issuer address. Throws if Solana can't be read.
 */
// A mint's permanent delegate is fixed when the mint is created, so a successful answer never
// goes stale. The check-in page polls every few seconds; this keeps that to one RPC call per badge.
const revocableCache = new Map<string, boolean>();

export async function isRevocable(event: Pick<EventRecord, "mint">, club: Pick<ClubRecord, "issuer">): Promise<boolean> {
  if (!event.mint) return false;
  const key = `${event.mint}:${club.issuer}`;
  const known = revocableCache.get(key);
  if (known !== undefined) return known;
  const answer = await readRevocable(event.mint, club);
  revocableCache.set(key, answer);
  return answer;
}

async function readRevocable(address: string, club: Pick<ClubRecord, "issuer">): Promise<boolean> {
  const connection = await getConnection();
  const mint = await withRetry(() =>
    getMint(connection, new PublicKey(address), "confirmed", TOKEN_2022_PROGRAM_ID),
  );
  const delegate = getPermanentDelegate(mint);
  return !!delegate && delegate.delegate.toBase58() === club.issuer;
}

/** How many tokens this token account holds (0 if it doesn't exist). */
async function heldAmount(ata: PublicKey): Promise<bigint> {
  try {
    const connection = await getConnection();
    const account = await withRetry(() =>
      getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID),
    );
    return account.amount;
  } catch (e) {
    if (e instanceof TokenAccountNotFoundError || e instanceof TokenInvalidAccountOwnerError) return BigInt(0);
    throw e;
  }
}

/**
 * Burns the badge from `owner`'s token account, signed by the club as permanent delegate, and
 * notes the time in `claims`. The organizer wallet pays the fee. The student's profile only counts
 * tokens with a balance above 0, so the badge drops off their track record once this confirms.
 */
export async function revokeBadge(event: EventRecord, club: ClubRecord, owner: PublicKey): Promise<RevokeResult> {
  if (!event.mint || !(await isRevocable(event, club))) return { status: "not_revocable" };

  const mint = new PublicKey(event.mint);
  const wallet = owner.toBase58();
  // The student's token account for this badge (one per wallet per token).
  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);

  const amount = await heldAmount(ata);
  if (amount === BigInt(0)) {
    // Nothing left to burn (e.g. an earlier burn landed but its confirmation timed out). The
    // officer picked this wallet, so note it either way and it leaves the list.
    await markRevoked(event.id, wallet, true);
    return { status: "not_held" };
  }

  const organizer = getOrganizerKeypair();
  const clubKey = getClubKeypair(club);
  const connection = await getConnection();

  const balance = await withRetry(() => connection.getBalance(organizer.publicKey));
  if (balance < FEE_BUFFER_LAMPORTS) {
    throw new OrganizerUnfundedError(organizer.publicKey.toBase58(), FEE_BUFFER_LAMPORTS);
  }

  const { blockhash, lastValidBlockHeight } = await withRetry(() =>
    connection.getLatestBlockhash("confirmed"),
  );
  // Burn: destroy the student's token(s). The club signs as permanent delegate, which the token
  // program accepts in place of the owner's signature; the organizer signs as fee payer.
  const tx = new Transaction({ feePayer: organizer.publicKey, blockhash, lastValidBlockHeight }).add(
    createBurnInstruction(ata, mint, clubKey.publicKey, amount, [], TOKEN_2022_PROGRAM_ID),
  );
  tx.sign(...uniqueSigners(organizer, clubKey));

  const signature = await connection.sendRawTransaction(tx.serialize());
  const result = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (result.value.err) throw new Error("Revoke transaction failed on-chain");

  await markRevoked(event.id, wallet, true);
  return { status: "revoked", signature };
}
