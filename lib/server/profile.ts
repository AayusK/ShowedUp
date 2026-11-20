import "server-only";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { ExtensionType, TOKEN_2022_PROGRAM_ID, getExtensionData, unpackMint } from "@solana/spl-token";
import { unpack } from "@solana/spl-token-metadata";
import { readEvents, type EventRecord } from "./events";
import { BADGE_SYMBOL, badgeMintAddress, getConnection, withRetry } from "./mint";
import { clubInfo, legacyClub, readClubs, type ClubRecord } from "./clubs";
import { CLUB_ID_RE, LEGACY_CLUB_ID } from "@/lib/clubs";
import { readKindAndRole, type BadgeKind, type Role } from "@/lib/badges";
import { getNextTier, getTier } from "@/lib/tiers";
import type { Profile, ProfileEvent, UnverifiedBadge } from "@/lib/profileClient";

export type { Profile, ProfileEvent, UnverifiedBadge };

const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
// A wallet can hold any number of unrelated tokens; don't look up more than this many.
const MAX_MINTS = 500;
// Anyone can send a wallet look-alike tokens; list only a few of them.
const MAX_UNVERIFIED = 20;

/** What a token says about itself. None of it is trusted until the issuer has been checked. */
export interface MintFacts {
  /** The one address allowed to hand out this token, or null if nobody can any more. */
  authority: string | null;
  symbol: string;
  name: string;
  date: string;
  location?: string;
  /** The badge id written into the token; the token's address is derived from it. */
  id?: string;
  /** Tokens from before role badges carry neither field and read as attendance / Attendee. */
  kind: BadgeKind;
  role: Role;
  /** The club name the token carries. Only a claim: the issuer's address is what gets checked. */
  clubName?: string;
}

/**
 * Reads a badge's details out of its token (the "mint" account). Returns null for anything
 * that isn't a Token-2022 mint carrying a name and a valid date (e.g. events created before
 * details were stored on-chain). This only reads; whether to believe it is decided below.
 */
export function readMintFacts(mint: PublicKey, info: AccountInfo<Buffer> | null): MintFacts | null {
  if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) return null;
  try {
    const parsed = unpackMint(mint, info, TOKEN_2022_PROGRAM_ID);
    const raw = getExtensionData(ExtensionType.TokenMetadata, parsed.tlvData);
    if (!raw) return null;
    const metadata = unpack(raw);
    if (!metadata.mint.equals(mint)) return null;
    const fields = new Map(metadata.additionalMetadata);
    const date = fields.get("date");
    if (!metadata.name || !date || !DATE_RE.test(date)) return null;
    const location = fields.get("location");
    const id = fields.get("id");
    const clubName = fields.get("club");
    return {
      authority: parsed.mintAuthority?.toBase58() ?? null,
      symbol: metadata.symbol,
      name: metadata.name,
      date,
      ...(location ? { location } : {}),
      ...(id && CLUB_ID_RE.test(id) ? { id } : {}),
      ...readKindAndRole(fields.get("kind"), fields.get("role")),
      ...(clubName ? { clubName } : {}),
    };
  } catch {
    return null; // not a mint, or data we don't understand: leave it out rather than guess
  }
}

/**
 * True if this token's address is the one derived from `issuer`'s wallet and the badge id.
 * Solana only creates an account at such an address when that wallet signs, so this proves the
 * club itself created the token. Anyone can redo this check with nothing but public data.
 */
export async function addressProvesIssuer(mint: PublicKey, issuer: string, id: string | undefined): Promise<boolean> {
  if (!id) return false;
  try {
    return (await badgeMintAddress(new PublicKey(issuer), id)).equals(mint);
  } catch {
    return false;
  }
}

export type BadgeVerdict =
  | { status: "verified"; club: ClubRecord }
  | { status: "unverified"; reason: UnverifiedBadge["reason"]; club: ClubRecord | null }
  | { status: "ignored" };

/**
 * Decides whether a token counts as a badge. Anyone can create a token and call it "Builders
 * Meeting", so the name proves nothing. What counts:
 *  1. its mint authority is the wallet of a club in our registry, and
 *  2. that club really created it: either the token's address is derived from the club's wallet
 *     (every badge made since clubs exist), or, for the default club's older badges, the token
 *     is listed in our own `events` table, and
 *  3. the registry admin has verified the club.
 * Step 2 matters because a mint authority can be handed to any address without its consent.
 */
export async function judgeBadge(
  mint: PublicKey,
  facts: MintFacts,
  clubsByIssuer: Map<string, ClubRecord>,
  listedByLegacyClub: boolean,
): Promise<BadgeVerdict> {
  const club = facts.authority ? clubsByIssuer.get(facts.authority) ?? null : null;
  if (club) {
    const created = (await addressProvesIssuer(mint, club.issuer, facts.id)) || (club.legacy && listedByLegacyClub);
    if (created) return club.verified ? { status: "verified", club } : { status: "unverified", reason: "club_not_verified", club };
    return { status: "unverified", reason: "address_mismatch", club };
  }
  // Not from a registered club. If it copies our format, say so; otherwise it's just some token.
  return facts.symbol === BADGE_SYMBOL ? { status: "unverified", reason: "unknown_issuer", club: null } : { status: "ignored" };
}

/**
 * A track record comes straight from the blockchain, in two steps:
 *  1. ask Solana for every Token-2022 account this wallet owns and keep the tokens it holds
 *  2. read each of those tokens and check who issued it (see judgeBadge). If a verified club
 *     issued it and it carries the event's name and date, that is a badge.
 * The database supplies the list of clubs, and is a fallback for older events whose tokens have
 * no details stored in them. If it can't be reached, badges that prove their issuer on-chain
 * still show for the default club (and `partial` is set).
 */
export async function getProfile(owner: PublicKey): Promise<Profile> {
  const connection = await getConnection();
  const [accounts, dbEvents, dbClubs] = await Promise.all([
    withRetry(() => connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed")),
    readEvents().catch((): EventRecord[] | null => null),
    readClubs().catch((): ClubRecord[] | null => null),
  ]);

  const heldMints = new Set<string>();
  for (const { account } of accounts.value) {
    // Treat RPC data as untrusted: only accept the shape we expect.
    const info = (account.data as { parsed?: { info?: { mint?: unknown; tokenAmount?: { amount?: unknown } } } })
      .parsed?.info;
    if (typeof info?.mint !== "string" || typeof info.tokenAmount?.amount !== "string") continue;
    if (BigInt(info.tokenAmount.amount) > BigInt(0)) heldMints.add(info.mint);
  }

  // Which wallets are clubs. Without the database we only know the default club (the organizer
  // wallet); without the organizer key we know none, and only the database fallback applies.
  const legacy = legacyClub();
  const clubs = dbClubs ?? [legacy];
  const clubsByIssuer = new Map(clubs.filter((c) => c.issuer).map((c) => [c.issuer, c]));

  const known = new Map((dbEvents ?? []).map((e) => [e.mint, e]));

  // Read the tokens our own events table lists first, so a wallet stuffed with junk tokens
  // can't push real badges past the MAX_MINTS limit.
  const facts = new Map<string, MintFacts>();
  const ordered = [...heldMints].sort((a, b) => Number(known.has(b)) - Number(known.has(a)));
  const keys = ordered.slice(0, MAX_MINTS).map((m) => new PublicKey(m));
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const infos = await withRetry(() => connection.getMultipleAccountsInfo(batch, "confirmed"));
    infos.forEach((info, j) => {
      const read = readMintFacts(batch[j], info);
      if (read) facts.set(batch[j].toBase58(), read);
    });
  }

  // A look-alike token may name a club. We only repeat that name if it is a registered club's.
  const clubNames = new Map(clubs.map((c) => [c.name.toLowerCase(), c.name]));
  const attended: ProfileEvent[] = [];
  const unverified: UnverifiedBadge[] = [];
  for (const mint of heldMints) {
    const badge = facts.get(mint);
    const row = known.get(mint);
    if (badge) {
      const listedByLegacyClub = !!row && (row.clubId ?? LEGACY_CLUB_ID) === LEGACY_CLUB_ID;
      const verdict = await judgeBadge(new PublicKey(mint), badge, clubsByIssuer, listedByLegacyClub);
      if (verdict.status === "verified") {
        attended.push({
          id: row?.id ?? mint,
          name: badge.name,
          date: badge.date,
          ...(badge.location ? { location: badge.location } : {}),
          mint,
          source: "chain",
          club: clubInfo(verdict.club),
          kind: badge.kind,
          role: badge.role,
        });
      } else if (verdict.status === "unverified" && (dbClubs === null || (verdict.club?.legacy && dbEvents === null))) {
        // Part of the database is down, so we can't tell a real badge from a look-alike (we
        // don't know every club, or can't confirm the default club's older badges). Leave it
        // out rather than call a real badge a copy; `partial` tells the page some may be missing.
      } else if (verdict.status === "unverified") {
        unverified.push({
          mint,
          issuer: badge.authority,
          date: badge.date,
          role: badge.role,
          club: verdict.club?.name ?? clubNames.get(badge.clubName?.toLowerCase() ?? "") ?? null,
          reason: verdict.reason,
        });
      }
    } else if (row && (row.clubId ?? LEGACY_CLUB_ID) === LEGACY_CLUB_ID) {
      // An older event: its token carries no details, so they come from our database.
      attended.push({
        id: row.id,
        name: row.name,
        date: row.date,
        ...(row.location ? { location: row.location } : {}),
        mint,
        source: "database",
        club: clubInfo(legacy),
        kind: "attendance",
        role: "Attendee",
      });
    }
  }
  attended.sort((a, b) => b.date.localeCompare(a.date));
  unverified.sort((a, b) => b.date.localeCompare(a.date));

  // Tiers count attendance only; contributions are counted separately.
  const count = attended.filter((e) => e.kind === "attendance").length;
  const next = getNextTier(count);
  return {
    wallet: owner.toBase58(),
    events: attended,
    count,
    contributions: attended.length - count,
    tier: getTier(count)?.name ?? null,
    nextTier: next ? { name: next.name, min: next.min, remaining: next.min - count } : null,
    unverified: unverified.slice(0, MAX_UNVERIFIED),
    unverifiedTotal: unverified.length,
    ...(dbEvents === null || dbClubs === null ? { partial: true } : {}),
  };
}
