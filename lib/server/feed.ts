import "server-only";
import { db } from "./db";
import { readEvents } from "./events";
import { readClubs } from "./clubs";
import { LEGACY_CLUB_ID } from "@/lib/clubs";
import { shortWallet, type FeedItem, type FeedResponse } from "@/lib/feed";

// The home page's live feed. It reads what the QuickNode Stream stored in `chain_claims`
// (lib/server/streamClaims.ts), keeps badges from verified clubs that weren't taken back, and
// returns a short list. No names: the members table is never read, and wallets are shortened.

// Postgres / PostgREST codes for "that table doesn't exist" and "that column doesn't exist".
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);
const READ_LIMIT = 40;
const SHOW_LIMIT = 12;

interface ChainClaimRow {
  signature: string;
  mint: string;
  wallet: string;
  block_time: string | null;
  received_at: string;
}

/** Keys "<event id>:<wallet>" for badges a club took back (db/04_revocation.sql). */
async function revokedKeys(eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const { data, error } = await db().from("claims")
    .select("event_id, wallet, revoked_at")
    .in("event_id", eventIds)
    .not("revoked_at", "is", null);
  // Before db/04 is run there is no revoked_at column, so nothing has been revoked.
  if (error && MISSING_COLUMN.has(error.code ?? "")) return new Set();
  if (error) throw new Error(`claims read failed: ${error.message}`);
  return new Set((data ?? []).map((r) => `${r.event_id as string}:${r.wallet as string}`));
}

// Every open home page polls this every 15 s. One answer per server instance is shared for a
// few seconds so a busy room doesn't turn into a full events read per tab per poll.
const CACHE_MS = 10_000;
let cached: { at: number; value: Promise<FeedResponse> } | null = null;

export function readFeed(): Promise<FeedResponse> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const value = readFeedUncached();
  cached = { at: now, value };
  value.catch(() => { cached = null; });
  return value;
}

async function readFeedUncached(): Promise<FeedResponse> {
  const [tokens, receipts] = await Promise.all([
    db().from("chain_claims").select("signature, mint, wallet, block_time, received_at")
      .order("received_at", { ascending: false }).limit(READ_LIMIT),
    db().from("contribution_receipts").select("signature, streamed_at, issuer:receipt_file->receipt->>issuer")
      .not("streamed_at", "is", null).not("confirmed_at", "is", null)
      .order("streamed_at", { ascending: false }).limit(READ_LIMIT),
  ]);
  for (const result of [tokens, receipts]) {
    if (result.error && !MISSING_TABLE.has(result.error.code)) throw new Error("Could not read the club feed");
  }
  const rows = (tokens.data ?? []) as ChainClaimRow[];
  if (!rows.length && !receipts.data?.length) return { items: [], stream: "off" };

  const [events, clubs] = await Promise.all([readEvents(), readClubs()]);
  const eventsByMint = new Map(events.map((e) => [e.mint, e]));
  // The default club is always verified (see legacyClub in clubs.ts).
  const verifiedClubs = new Map(clubs.filter((c) => c.verified).map((c) => [c.id, c.name]));

  const candidates = rows.flatMap((row) => {
    const event = eventsByMint.get(row.mint);
    if (!event) return [];
    const club = verifiedClubs.get(event.clubId ?? LEGACY_CLUB_ID);
    if (!club) return [];
    return [{ row, event, club }];
  });
  const revoked = await revokedKeys([...new Set(candidates.map((c) => c.event.id))]);

  const items: FeedItem[] = candidates
    .filter(({ row, event }) => !revoked.has(`${event.id}:${row.wallet}`))
    .map(({ row, event, club }) => {
      const contribution = event.kind === "contribution";
      const time = Date.parse(row.block_time ?? row.received_at);
      return {
        wallet: shortWallet(row.wallet),
        role: contribution ? (event.role ?? null) : null,
        kind: contribution ? "contribution" as const : "attendance" as const,
        club,
        eventName: event.name,
        at: new Date(Number.isFinite(time) ? time : Date.now()).toISOString(),
        signature: row.signature,
      };
    });
  const issuers = new Map(clubs.filter(c => c.verified).map(c => [c.issuer, c.name]));
  for (const row of receipts.data ?? []) {
    const club = issuers.get(String(row.issuer));
    if (club) items.push({ kind: "receipt", club, at: row.streamed_at, signature: row.signature });
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  return { items: items.slice(0, SHOW_LIMIT), stream: "on" };
}
