import "server-only";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { readEvents } from "./events";
import { getConnection, withRetry } from "./mint";
import { getNextTier, getTier } from "@/lib/tiers";
import type { Profile, ProfileEvent } from "@/lib/profileClient";

export type { Profile, ProfileEvent };

/**
 * Attendance comes straight from the blockchain: we ask Solana for every Token-2022
 * account this wallet owns, and keep the ones whose token belongs to one of our events
 * and has a balance above 0. events.json only adds names and dates.
 */
export async function getProfile(owner: PublicKey): Promise<Profile> {
  const connection = getConnection();
  const [accounts, events] = await Promise.all([
    withRetry(() => connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed")),
    readEvents(),
  ]);

  const heldMints = new Set<string>();
  for (const { account } of accounts.value) {
    // Treat RPC data as untrusted: only accept the shape we expect.
    const info = (account.data as { parsed?: { info?: { mint?: unknown; tokenAmount?: { amount?: unknown } } } })
      .parsed?.info;
    if (typeof info?.mint !== "string" || typeof info.tokenAmount?.amount !== "string") continue;
    if (BigInt(info.tokenAmount.amount) > BigInt(0)) heldMints.add(info.mint);
  }

  const attended = events
    .filter((e) => heldMints.has(e.mint))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(({ id, name, date, location, mint }) => ({ id, name, date, ...(location ? { location } : {}), mint }));

  const count = attended.length;
  const next = getNextTier(count);
  return {
    wallet: owner.toBase58(),
    events: attended,
    count,
    tier: getTier(count)?.name ?? null,
    nextTier: next ? { name: next.name, min: next.min, remaining: next.min - count } : null,
  };
}
