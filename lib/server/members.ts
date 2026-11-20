import "server-only";
import { db, readPages } from "./db";
import type { EventRecord } from "./events";

// Postgres / PostgREST codes for "that column doesn't exist": the new SQL hasn't been run yet.
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);

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

/**
 * Everyone who has checked in to any of this club's events (or been awarded one of its badges),
 * with their saved name, sorted by name. This is the list an officer picks from when awarding a
 * contribution. Names are only ever sent to that club's officers.
 */
export async function clubMembers(allEvents: Pick<EventRecord, "id" | "mint" | "kind">[]): Promise<{ wallet: string; name: string }[]> {
  // Only check-ins count. Being awarded a badge by address doesn't make someone a member, so it
  // never shows a club their saved name.
  const events = allEvents.filter((e) => e.kind !== "contribution");
  if (events.length === 0) return [];
  const mints = events.flatMap(e => e.mint ? [e.mint] : []);
  const [recorded, streamed] = await Promise.all([
    db().from("claims").select("wallet").in("event_id", events.map((e) => e.id)).eq("status", "confirmed"),
    mints.length ? db().from("chain_claims").select("wallet").in("mint", mints) : { data: [], error: null },
  ]);
  if (recorded.error) throw new Error(`member read failed: ${recorded.error.message}`);
  const wallets = [...new Set([
    ...(recorded.data ?? []).map((r) => r.wallet as string),
    ...(streamed.error ? [] : (streamed.data ?? [])).map((r) => r.wallet as string),
  ])].slice(0, 1000);
  if (wallets.length === 0) return [];

  const { data: members, error } = await db().from("members").select("wallet, name").in("wallet", wallets);
  if (error) throw new Error(`member read failed: ${error.message}`);
  const names = new Map((members ?? []).map((m) => [m.wallet as string, m.name as string]));
  return wallets
    .map((wallet) => ({ wallet, name: names.get(wallet) ?? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
export async function eventAttendees(event: Pick<EventRecord, "id" | "mint">): Promise<Attendee[]> {
  const eventId = event.id;

  const readClaims = (columns: string) => readPages((first, last) =>
    db().from("claims").select(columns).eq("event_id", eventId).eq("status", "confirmed")
      .order("wallet").range(first, last));
  const [streamed, firstRead] = await Promise.all([
    event.mint ? readPages((first, last) => db().from("chain_claims").select("wallet, block_time, received_at")
      .eq("mint", event.mint!).order("signature").range(first, last)) : { data: [], error: null },
    readClaims("wallet, updated_at, revoked_at"),
  ]);
  // Before db/04_revocation.sql is run there is no `revoked_at` column: nobody has been revoked.
  const recorded = firstRead.error && MISSING_COLUMN.has(firstRead.error.code ?? "")
    ? await readClaims("wallet, updated_at")
    : firstRead;
  if (recorded.error) throw new Error(`attendee read failed: ${recorded.error.message}`);
  const claimRows = (recorded.data ?? []) as unknown as { wallet: string; updated_at: string | null; revoked_at?: string | null }[];

  // A badge the club took back is burned on Solana; leave that wallet out, whichever source saw it.
  const revoked = new Set(claimRows.filter((r) => r.revoked_at).map((r) => r.wallet));
  const byWallet = new Map<string, { source: Attendee["source"]; at: string | null }>();
  for (const row of streamed.error ? [] : (streamed.data ?? [])) {
    if (revoked.has(row.wallet as string)) continue;
    const at = (row.block_time ?? row.received_at ?? null) as string | null;
    const seen = byWallet.get(row.wallet as string);
    if (!seen || (at && (!seen.at || at > seen.at))) byWallet.set(row.wallet as string, { source: "stream", at });
  }
  for (const row of claimRows) {
    if (!revoked.has(row.wallet) && !byWallet.has(row.wallet)) {
      byWallet.set(row.wallet, { source: "app", at: row.updated_at ?? null });
    }
  }
  if (byWallet.size === 0) return [];

  const wallets = [...byWallet.keys()];
  const names = new Map<string, string>();
  // Keep the encoded wallet list in each PostgREST URL below typical proxy limits.
  for (let i = 0; i < wallets.length; i += 80) {
    const { data, error } = await db().from("members").select("wallet, name").in("wallet", wallets.slice(i, i + 80));
    if (error) throw new Error(`member read failed: ${error.message}`);
    for (const m of data ?? []) names.set(m.wallet, m.name);
  }

  const time = (at: string | null) => (at ? Date.parse(at) || 0 : 0);
  return wallets
    .map((wallet) => ({
      wallet,
      name: names.get(wallet) ?? `${wallet.slice(0, 4)}…${wallet.slice(-4)}`,
      ...byWallet.get(wallet)!,
    }))
    .sort((a, b) => time(b.at) - time(a.at));
}
