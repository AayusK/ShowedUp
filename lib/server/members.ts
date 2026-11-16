import "server-only";
import { db } from "./db";

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
}

/** Everyone with a confirmed claim for this event, newest check-in first. */
export async function eventAttendees(eventId: string): Promise<Attendee[]> {
  const { data: claims, error } = await db().from("claims")
    .select("wallet, updated_at").eq("event_id", eventId).eq("status", "confirmed")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`attendee read failed: ${error.message}`);
  if (!claims || claims.length === 0) return [];

  const wallets = claims.map((c) => c.wallet as string);
  const { data: members, error: memberErr } = await db().from("members").select("wallet, name").in("wallet", wallets);
  if (memberErr) throw new Error(`member read failed: ${memberErr.message}`);
  const names = new Map((members ?? []).map((m) => [m.wallet as string, m.name as string]));

  return wallets.map((wallet) => ({ wallet, name: names.get(wallet) ?? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` }));
}
