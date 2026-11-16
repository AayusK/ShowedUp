// Client-side types + fetcher for GET /api/profile/[wallet].

export interface ProfileEvent {
  /** The event's id, or its token address for badges our database doesn't list. */
  id: string;
  name: string;
  date: string;
  location?: string;
  mint: string;
  /** Where the name and date came from: the token itself, or (older events) our database. */
  source: "chain" | "database";
}

export interface Profile {
  wallet: string;
  events: ProfileEvent[];
  count: number;
  tier: string | null;
  nextTier: { name: string; min: number; remaining: number } | null;
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
