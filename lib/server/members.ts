import "server-only";
import { db } from "./db";
import { getEvent } from "./events";

// One display name per wallet, asked for on a wallet's first claim and reused afterwards.
// Only the server reads this table; the browser can learn *whether* a wallet has a name,
// never the name itself (so nobody can look up who owns a wallet).

export async function hasMemberName(wallet: string): Promise<boolean> {
  const { data, error } = await db().from("members").select("wallet").eq("wallet", wallet).maybeSingle();
  if (error) throw new Error(`member read failed: ${error.message}`);
  return !!data;
}

export async function saveMemberName(wallet: string, name: string): Promise<void> {
  const { error } = await db().from("members")
    .upsert({ wallet, name, updated_at: new Date().toISOString() });
  if (error) throw new Error(`member save failed: ${error.message}`);
}

export interface Attendee {
  wallet: string;
  /** The saved name, or a shortened wallet for people who claimed before names existed. */
  name: string;
  /**
   * How we know they checked in. "stream": the QuickNode Stream saw the token being handed out
   * on Solana. "app": this app recorded it when it sent the transaction (the stream hasn't
   * reported it, e.g. because no stream is connected or it is paused).
   */
  source: "stream" | "app";
  /** When they checked in (the block's time for stream entries), newest first. */
  at: string | null;
}

/**
 * Everyone who has checked in to this event, newest first.
 * Two sources are merged so nobody is ever missing:
 *  - `chain_claims`: claims the QuickNode Stream saw on-chain (see lib/server/streamClaims.ts).
 *    This also catches tokens handed out outside the web app, e.g. by the seed script.
 *  - `claims`: this app's own record of the claims it minted.
 * If the stream table doesn't exist or can't be read, the list is simply the app's own record.
 */
export async function eventAttendees(eventId: string): Promise<Attendee[]> {
  const event = await getEvent(eventId);
  if (!event) return [];

  const [streamed, recorded] = await Promise.all([
    db().from("chain_claims").select("wallet, block_time, received_at").eq("mint", event.mint),
    db().from("claims").select("wallet, updated_at").eq("event_id", eventId).eq("status", "confirmed"),
  ]);
  if (recorded.error) throw new Error(`attendee read failed: ${recorded.error.message}`);

  const byWallet = new Map<string, { source: Attendee["source"]; at: string | null }>();
  for (const row of streamed.error ? [] : (streamed.data ?? [])) {
    const at = (row.block_time ?? row.received_at ?? null) as string | null;
    const seen = byWallet.get(row.wallet as string);
    if (!seen || (at && (!seen.at || at > seen.at))) byWallet.set(row.wallet as string, { source: "stream", at });
  }
  for (const row of recorded.data ?? []) {
    if (!byWallet.has(row.wallet as string)) {
      byWallet.set(row.wallet as string, { source: "app", at: (row.updated_at ?? null) as string | null });
    }
  }
  if (byWallet.size === 0) return [];

  const wallets = [...byWallet.keys()];
  const { data: members, error: memberErr } = await db().from("members").select("wallet, name").in("wallet", wallets);
  if (memberErr) throw new Error(`member read failed: ${memberErr.message}`);
  const names = new Map((members ?? []).map((m) => [m.wallet as string, m.name as string]));

  const time = (at: string | null) => (at ? Date.parse(at) || 0 : 0);
  return wallets
    .map((wallet) => ({
      wallet,
      name: names.get(wallet) ?? `${wallet.slice(0, 4)}…${wallet.slice(-4)}`,
      ...byWallet.get(wallet)!,
    }))
    .sort((a, b) => time(b.at) - time(a.at));
}
