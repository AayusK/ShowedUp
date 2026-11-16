// Client-side types + fetcher for GET /api/profile/[wallet].

export interface ProfileEvent {
  id: string;
  name: string;
  date: string;
  location?: string;
  mint: string;
}

export interface Profile {
  wallet: string;
  events: ProfileEvent[];
  count: number;
  tier: string | null;
  nextTier: { name: string; min: number; remaining: number } | null;
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
