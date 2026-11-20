import "server-only";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import { db } from "./db";
import type { EventRecord } from "./events";
import { getConnection, withRetry } from "./mint";

/**
 * Attendees per event, read from the chain. Every attendee gets exactly 1 token and can't
 * pass it on, so a mint's total supply = how many people checked in.
 * One RPC call per 100 events (getMultipleAccountsInfo).
 */
async function getMintSupplies(mints: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const keys = mints.map((m) => new PublicKey(m));
  const connection = await getConnection();
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

/** A devnet outage must not hide the counts for database-only events. */
export async function getAttendeeCounts(events: EventRecord[]): Promise<Record<string, number>> {
  const privateIds = events.filter(e => !e.mint).map(e => e.id);
  const tokens = events.flatMap(e => e.mint ? [{ id: e.id, mint: e.mint }] : []);
  const [privateResult, supplyResult] = await Promise.allSettled([
    privateIds.length ? db().rpc("private_checkin_counts", { event_ids: privateIds }) : null,
    tokens.length ? getMintSupplies(tokens.map(e => e.mint)) : Promise.resolve<Record<string, number>>({}),
  ]);
  const counts: Record<string, number> = {};
  if (privateResult.status === "fulfilled" && privateResult.value && !privateResult.value.error) {
    for (const id of privateIds) counts[id] = 0;
    for (const row of privateResult.value.data) counts[row.event_id] = Number(row.attendees);
  }
  if (supplyResult.status === "fulfilled") {
    for (const { id, mint } of tokens) {
      if (supplyResult.value[mint] !== undefined) counts[id] = supplyResult.value[mint];
    }
  }
  return counts;
}
