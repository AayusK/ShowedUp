import "server-only";
import { db } from "./db";
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
  // Someone an officer added by hand (db/05_manual_attendance.sql) didn't check in themselves,
  // so that alone doesn't make them a member. Before that SQL is run, nobody is officer-added.
  const selfClaims = () => db().from("claims").select("wallet").in("event_id", events.map((e) => e.id)).eq("status", "confirmed");
  const [firstRecorded, streamed] = await Promise.all([
    selfClaims().eq("added_by_officer", false),
    db().from("chain_claims").select("wallet").in("mint", events.map((e) => e.mint)),
  ]);
  const recorded = firstRecorded.error && MISSING_COLUMN.has(firstRecorded.error.code ?? "") ? await selfClaims() : firstRecorded;
  // The stream sees every mint, including officer-added ones: leave those wallets out unless
  // they also checked in themselves.
  const officerOnly = new Set<string>();
  if (!firstRecorded.error) {
    const { data: added } = await db().from("claims").select("wallet")
      .in("event_id", events.map((e) => e.id)).eq("added_by_officer", true);
    for (const r of added ?? []) officerOnly.add(r.wallet as string);
    for (const r of recorded.data ?? []) officerOnly.delete(r.wallet as string);
  }
  if (recorded.error) throw new Error(`member read failed: ${recorded.error.message}`);
  const wallets = [...new Set([
    ...(recorded.data ?? []).map((r) => r.wallet as string),
    ...(streamed.error ? [] : (streamed.data ?? [])).map((r) => r.wallet as string).filter((w) => !officerOnly.has(w)),
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
  /** An officer added them by hand after they missed the scan (db/05_manual_attendance.sql). */
  addedByOfficer?: boolean;
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

  const readClaims = (columns: string) =>
    db().from("claims").select(columns).eq("event_id", eventId).eq("status", "confirmed");
  const [streamed, firstRead] = await Promise.all([
    db().from("chain_claims").select("wallet, block_time, received_at").eq("mint", event.mint),
    readClaims("wallet, updated_at, revoked_at, added_by_officer"),
  ]);
  // Older databases lack newer columns: without db/05 nobody was added by an officer, and
  // without db/04 nobody has been revoked.
  let recorded = firstRead;
  if (recorded.error && MISSING_COLUMN.has(recorded.error.code ?? "")) recorded = await readClaims("wallet, updated_at, revoked_at");
  if (recorded.error && MISSING_COLUMN.has(recorded.error.code ?? "")) recorded = await readClaims("wallet, updated_at");
  if (recorded.error) throw new Error(`attendee read failed: ${recorded.error.message}`);
  const claimRows = (recorded.data ?? []) as unknown as { wallet: string; updated_at: string | null; revoked_at?: string | null; added_by_officer?: boolean }[];
  const officerAdded = new Set(claimRows.filter((r) => r.added_by_officer).map((r) => r.wallet));

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
  const { data: members, error: memberErr } = await db().from("members").select("wallet, name").in("wallet", wallets);
  if (memberErr) throw new Error(`member read failed: ${memberErr.message}`);
  const names = new Map((members ?? []).map((m) => [m.wallet as string, m.name as string]));

  const time = (at: string | null) => (at ? Date.parse(at) || 0 : 0);
  return wallets
    .map((wallet) => ({
      wallet,
      name: names.get(wallet) ?? `${wallet.slice(0, 4)}…${wallet.slice(-4)}`,
      ...byWallet.get(wallet)!,
      ...(officerAdded.has(wallet) ? { addedByOfficer: true } : {}),
    }))
    .sort((a, b) => time(b.at) - time(a.at));
}

export interface RosterEntry {
  wallet: string;
  /** Saved name for people who checked in to this club themselves; otherwise a short wallet. */
  name: string;
  /** Attendance badges from this club (QR scans plus officer adds), revoked ones left out. */
  attended: number;
  /** Role badges from this club, e.g. { Mentor: 1 }. */
  roles: Record<string, number>;
  /** Newest badge from this club (ISO date of the event), for sorting ties. */
  lastEvent: string;
}

/**
 * Everyone holding a badge from this club, with how many events they attended and which role
 * badges they have, most active first. Reads the app's own claims plus what the QuickNode
 * Stream saw on Solana, and leaves out revoked badges. Names follow the same rule as everywhere
 * else: only people who checked in to this club themselves show a name.
 */
export async function clubRoster(events: EventRecord[]): Promise<RosterEntry[]> {
  if (events.length === 0) return [];
  const byId = new Map(events.map((e) => [e.id, e]));
  const byMint = new Map(events.map((e) => [e.mint, e]));

  const readClaims = (columns: string) =>
    db().from("claims").select(columns).in("event_id", events.map((e) => e.id)).eq("status", "confirmed");
  const [firstRead, streamed] = await Promise.all([
    readClaims("wallet, event_id, revoked_at"),
    db().from("chain_claims").select("wallet, mint").in("mint", events.map((e) => e.mint)),
  ]);
  // Before db/04_revocation.sql there is no revoked_at column: nobody has been revoked.
  const recorded = firstRead.error && MISSING_COLUMN.has(firstRead.error.code ?? "") ? await readClaims("wallet, event_id") : firstRead;
  if (recorded.error) throw new Error(`roster read failed: ${recorded.error.message}`);
  const rows = (recorded.data ?? []) as unknown as { wallet: string; event_id: string; revoked_at?: string | null }[];

  // One badge per (event, wallet); revoked ones don't count, whichever source saw them.
  const revoked = new Set(rows.filter((r) => r.revoked_at).map((r) => `${r.event_id}:${r.wallet}`));
  const held = new Set<string>();
  for (const r of rows) if (!r.revoked_at) held.add(`${r.event_id}:${r.wallet}`);
  for (const s of streamed.error ? [] : (streamed.data ?? [])) {
    const event = byMint.get(s.mint as string);
    if (!event) continue;
    const key = `${event.id}:${s.wallet as string}`;
    if (!revoked.has(key)) held.add(key);
  }

  const people = new Map<string, RosterEntry>();
  for (const key of held) {
    const split = key.indexOf(":");
    const event = byId.get(key.slice(0, split));
    const wallet = key.slice(split + 1);
    if (!event) continue;
    let p = people.get(wallet);
    if (!p) { p = { wallet, name: `${wallet.slice(0, 4)}…${wallet.slice(-4)}`, attended: 0, roles: {}, lastEvent: "" }; people.set(wallet, p); }
    if (event.kind === "contribution" && event.role) p.roles[event.role] = (p.roles[event.role] ?? 0) + 1;
    else p.attended += 1;
    if (event.date > p.lastEvent) p.lastEvent = event.date;
  }
  if (people.size === 0) return [];

  // Names only for people who checked in to this club themselves (clubMembers applies that rule).
  for (const m of await clubMembers(events)) {
    const p = people.get(m.wallet);
    if (p) p.name = m.name;
  }
  const badgeCount = (p: RosterEntry) => Object.values(p.roles).reduce((a, b) => a + b, 0);
  return [...people.values()]
    .sort((a, b) => b.attended - a.attended || badgeCount(b) - badgeCount(a) || b.lastEvent.localeCompare(a.lastEvent))
    .slice(0, 500);
}
