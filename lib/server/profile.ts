import "server-only";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { ExtensionType, TOKEN_2022_PROGRAM_ID, getExtensionData, unpackMint } from "@solana/spl-token";
import { unpack } from "@solana/spl-token-metadata";
import { readEvents, type EventRecord } from "./events";
import { getConnection, withRetry } from "./mint";
import { getOrganizerKeypair } from "./organizer";
import { getNextTier, getTier } from "@/lib/tiers";
import type { Profile, ProfileEvent } from "@/lib/profileClient";

export type { Profile, ProfileEvent };

const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
// A wallet can hold any number of unrelated tokens; don't look up more than this many.
const MAX_MINTS = 500;

interface BadgeDetails {
  name: string;
  date: string;
  location?: string;
}

/**
 * Reads an event's details out of its token (the "mint" account) and checks it is really ours.
 * Anyone can create a token and call it "Builders Meeting", so the name alone proves nothing.
 * What can't be faked is the mint authority: the one address allowed to hand out that token.
 * We only accept tokens whose mint authority is our organizer wallet.
 * Returns null for tokens that aren't ours or that carry no (valid) details.
 */
function readBadge(mint: PublicKey, info: AccountInfo<Buffer> | null, organizer: PublicKey): BadgeDetails | null {
  if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) return null;
  try {
    const parsed = unpackMint(mint, info, TOKEN_2022_PROGRAM_ID);
    if (!parsed.mintAuthority?.equals(organizer)) return null;
    const raw = getExtensionData(ExtensionType.TokenMetadata, parsed.tlvData);
    if (!raw) return null; // events created before details were stored on-chain
    const metadata = unpack(raw);
    if (!metadata.mint.equals(mint)) return null;
    const fields = new Map(metadata.additionalMetadata);
    const date = fields.get("date");
    if (!metadata.name || !date || !DATE_RE.test(date)) return null;
    const location = fields.get("location");
    return { name: metadata.name, date, ...(location ? { location } : {}) };
  } catch {
    return null; // not a mint, or data we don't understand: leave it out rather than guess
  }
}

/**
 * Attendance comes straight from the blockchain, in two steps:
 *  1. ask Solana for every Token-2022 account this wallet owns and keep the tokens it holds
 *  2. read each of those tokens: if our organizer issued it and it carries the event's name and
 *     date, that is a badge. No database needed for this part.
 * The database is only a fallback for older events, whose tokens have no details stored in them.
 * If the database can't be reached, on-chain badges still show (and `partial` is set).
 */
export async function getProfile(owner: PublicKey): Promise<Profile> {
  const connection = getConnection();
  const [accounts, dbEvents] = await Promise.all([
    withRetry(() => connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed")),
    readEvents().catch((): EventRecord[] | null => null),
  ]);

  const heldMints = new Set<string>();
  for (const { account } of accounts.value) {
    // Treat RPC data as untrusted: only accept the shape we expect.
    const info = (account.data as { parsed?: { info?: { mint?: unknown; tokenAmount?: { amount?: unknown } } } })
      .parsed?.info;
    if (typeof info?.mint !== "string" || typeof info.tokenAmount?.amount !== "string") continue;
    if (BigInt(info.tokenAmount.amount) > BigInt(0)) heldMints.add(info.mint);
  }

  // Without the organizer key we can't tell our tokens from look-alikes, so only the database
  // fallback applies.
  let organizer: PublicKey | null = null;
  try {
    organizer = getOrganizerKeypair().publicKey;
  } catch {}

  const onChain = new Map<string, BadgeDetails>();
  if (organizer) {
    const keys = [...heldMints].slice(0, MAX_MINTS).map((m) => new PublicKey(m));
    for (let i = 0; i < keys.length; i += 100) {
      const batch = keys.slice(i, i + 100);
      const infos = await withRetry(() => connection.getMultipleAccountsInfo(batch, "confirmed"));
      infos.forEach((info, j) => {
        const badge = readBadge(batch[j], info, organizer);
        if (badge) onChain.set(batch[j].toBase58(), badge);
      });
    }
  }

  const known = new Map((dbEvents ?? []).map((e) => [e.mint, e]));
  const attended: ProfileEvent[] = [];
  for (const mint of heldMints) {
    const badge = onChain.get(mint);
    const row = known.get(mint);
    if (badge) attended.push({ id: row?.id ?? mint, ...badge, mint, source: "chain" });
    else if (row) {
      attended.push({
        id: row.id,
        name: row.name,
        date: row.date,
        ...(row.location ? { location: row.location } : {}),
        mint,
        source: "database",
      });
    }
  }
  attended.sort((a, b) => b.date.localeCompare(a.date));

  const count = attended.length;
  const next = getNextTier(count);
  return {
    wallet: owner.toBase58(),
    events: attended,
    count,
    tier: getTier(count)?.name ?? null,
    nextTier: next ? { name: next.name, min: next.min, remaining: next.min - count } : null,
    ...(dbEvents === null ? { partial: true } : {}),
  };
}
