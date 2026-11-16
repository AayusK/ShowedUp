import "server-only";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import { getConnection, withRetry } from "./mint";

/**
 * Attendees per event, read from the chain. Every attendee gets exactly 1 token and can't
 * pass it on, so a mint's total supply = how many people checked in.
 * One RPC call per 100 events (getMultipleAccountsInfo).
 */
export async function getAttendeeCounts(mints: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const keys = mints.map((m) => new PublicKey(m));
  const connection = getConnection();
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const infos = await withRetry(() => connection.getMultipleAccountsInfo(batch, "confirmed"));
    infos.forEach((info, j) => {
      if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) return;
      try {
        counts[batch[j].toBase58()] = Number(unpackMint(batch[j], info, TOKEN_2022_PROGRAM_ID).supply);
      } catch {
        // Not a valid mint account; leave it out rather than guess.
      }
    });
  }
  return counts;
}
