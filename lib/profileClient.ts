// Client-side types + fetcher for GET /api/profile/[wallet].
import type { ReceiptFile } from "@/lib/receipt";
import type { ClubInfo } from "@/lib/clubs";
import type { BadgeKind, Role } from "@/lib/badges";

export interface ProfileEvent {
  /** The event's id, or its token address for badges our database doesn't list. */
  id: string;
  name: string;
  date: string;
  location?: string;
  mint: string | null;
  /** Sent only in a wallet-authorized view or to the club receiving an application. */
  receiptFile?: ReceiptFile;
  /** Where the name and date came from: the token itself, or (older events) our database. */
  source: "chain" | "database" | "checkin" | "receipt";
  /** The verified club that issued this badge, worked out from the token's issuer on-chain. */
  club: ClubInfo;
  /** "attendance" (claimed with the QR code) or "contribution" (awarded by an officer). */
  kind: BadgeKind;
  /** What they did. Always "Attendee" for attendance badges. Read from the token. */
  role: Role;
}

/**
 * A token that looks like a ShowedUp badge but isn't counted. Only checked facts are passed on:
 * the free-text name such a token carries is never shown, since anyone can send any wallet a
 * token saying anything.
 */
export interface UnverifiedBadge {
  mint: string;
  /** The address that controls this token (its mint authority), or null if nobody does. */
  issuer: string | null;
  date: string;
  /** The role the token claims, from the fixed list. */
  role: Role;
  /** A registered club this token is from or names. Being named proves nothing by itself. */
  club: string | null;
  /**
   * Why it isn't counted. "unknown_issuer": the issuer is not a registered club.
   * "club_not_verified": a registered club issued it, but the admin hasn't verified that club.
   * "address_mismatch": it names a registered club's wallet, but that wallet didn't create it.
   */
  reason: "unknown_issuer" | "club_not_verified" | "address_mismatch";
}

export interface Profile {
  wallet: string;
  /** Verified badges only, newest first. */
  events: ProfileEvent[];
  /** How many verified attendance badges; the perk tiers count these. */
  count: number;
  /** How many verified contribution badges (Mentor, Speaker, ...). */
  contributions: number;
  tier: string | null;
  nextTier: { name: string; min: number; remaining: number } | null;
  /** Look-alike or not-yet-verified tokens (at most 20 are listed). Never counted. */
  unverified: UnverifiedBadge[];
  unverifiedTotal: number;
  /** Set when the database couldn't be reached: only badges readable from the chain are listed. */
  partial?: boolean;
}

export type ProfileResult = { ok: true; profile: Profile } | { ok: false; error: "invalid_wallet" | "rpc_error" | "network" };

export async function fetchProfile(wallet: string): Promise<ProfileResult> {
  try {
    const res = await fetch(`/api/profile/${encodeURIComponent(wallet)}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, profile: data as Profile };
    return { ok: false, error: data.error === "invalid_wallet" ? "invalid_wallet" : "rpc_error" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
