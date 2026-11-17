import "server-only";
import { db } from "./db";

// A claim row is a lock that works across every server instance: the (event_id, wallet)
// primary key means only one request can hold it. The blockchain remains the source of truth
// for attendance; this just stops two requests from minting at the same time.

const STALE_MS = 2 * 60_000; // a "pending" row older than this is from a request that died

export type Reservation = "reserved" | "confirmed" | "in_progress";

export async function reserveClaim(eventId: string, wallet: string): Promise<Reservation> {
  const { error } = await db().from("claims").insert({ event_id: eventId, wallet, status: "pending" });
  if (!error) return "reserved";
  if (error.code !== "23505") throw new Error(`claim reserve failed: ${error.message}`); // 23505 = already exists

  const { data: existing, error: readErr } = await db()
    .from("claims").select("status, updated_at").eq("event_id", eventId).eq("wallet", wallet).maybeSingle();
  if (readErr) throw new Error(`claim read failed: ${readErr.message}`);
  if (!existing) return "in_progress";
  if (existing.status === "confirmed") return "confirmed";

  // Take over a stale pending row (atomic: only succeeds if it's still stale).
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const { data: taken, error: takeErr } = await db()
    .from("claims").update({ updated_at: new Date().toISOString() })
    .eq("event_id", eventId).eq("wallet", wallet).eq("status", "pending").lt("updated_at", cutoff)
    .select("wallet");
  if (takeErr) throw new Error(`claim takeover failed: ${takeErr.message}`);
  return taken && taken.length > 0 ? "reserved" : "in_progress";
}

export async function confirmClaim(eventId: string, wallet: string, signature: string): Promise<void> {
  const { error } = await db().from("claims")
    .update({ status: "confirmed", signature, updated_at: new Date().toISOString() })
    .eq("event_id", eventId).eq("wallet", wallet);
  if (error) console.error("[claims] confirm failed:", error.message); // token is minted either way
}

/** Mark an already-held token as confirmed (e.g. claims from before the database existed). */
export async function recordExistingClaim(eventId: string, wallet: string): Promise<void> {
  await db().from("claims").upsert({ event_id: eventId, wallet, status: "confirmed", updated_at: new Date().toISOString() });
}

export async function releaseClaim(eventId: string, wallet: string): Promise<void> {
  await db().from("claims").delete().eq("event_id", eventId).eq("wallet", wallet).eq("status", "pending");
}

// Postgres / PostgREST codes for "that column doesn't exist": db/04_revocation.sql hasn't been run.
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);

/**
 * Notes that a club took back this badge (the token is already burned on Solana by now).
 * With `addIfMissing` (after a real burn), a wallet the app never recorded (e.g. seen only by the
 * QuickNode Stream) gets a row too, so it drops off the attendee list. Never throws: the burn on
 * Solana is what counts.
 */
export async function markRevoked(eventId: string, wallet: string, addIfMissing = false): Promise<void> {
  const revokedAt = new Date().toISOString();
  const { data, error } = await db().from("claims")
    .update({ revoked_at: revokedAt, updated_at: revokedAt })
    // Only a finished claim. A claim still in flight keeps its lock; if it lands later, the
    // badge stays visible and revocable rather than hidden while still held.
    .eq("event_id", eventId).eq("wallet", wallet).eq("status", "confirmed").select("wallet");
  if (error && MISSING_COLUMN.has(error.code ?? "")) {
    console.warn("[claims] revoked_at column missing (run db/04_revocation.sql); burn still counts");
    return;
  }
  if (error) { console.error("[claims] revoke note failed:", error.message.split("\n")[0]); return; }
  if (!addIfMissing || (data && data.length > 0)) return;
  const { error: insertErr } = await db().from("claims")
    .insert({ event_id: eventId, wallet, status: "confirmed", revoked_at: revokedAt, updated_at: revokedAt });
  if (insertErr && insertErr.code !== "23505") console.error("[claims] revoke note failed:", insertErr.message.split("\n")[0]);
}
