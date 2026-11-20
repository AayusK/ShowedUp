import "server-only";
import type { PublicKey } from "@solana/web3.js";
import { LEGACY_CLUB_ID } from "@/lib/clubs";
import { isRole, type Role } from "@/lib/badges";
import type { Profile, ProfileEvent } from "@/lib/profileClient";
import { parseReceiptFile, recordHash, verifyReceipt, type RecordValue } from "@/lib/receipt";
import { getNextTier, getTier } from "@/lib/tiers";
import { clubInfo, readClubs } from "./clubs";
import { db, readPages } from "./db";
import { getConnection } from "./mint";
import { getProfile } from "./profile";

type View = { kind: "owner" } | { kind: "opening"; role: Role | null; appliedAt?: string };
const fields = (value: RecordValue) => value && typeof value === "object" && !Array.isArray(value) ? value : null;

interface CheckinEvent {
  id: string; name: string; starts_at: string; location: string | null; club_id: string | null;
}

async function privateEvents(wallet: string, view: View) {
  const events: ProfileEvent[] = [];
  let partial = false;
  let receipts = db().from("contribution_receipts").select("event_id,role,receipt_file")
    .eq("wallet", wallet).not("confirmed_at", "is", null).order("event_id").order("role");
  if (view.kind === "opening" && view.role) receipts = receipts.eq("role", view.role);
  // Applying shares the matching receipts the student had at the time of application.
  if (view.kind === "opening" && view.appliedAt) receipts = receipts.lte("confirmed_at", view.appliedAt);
  const [clubList, receiptRows, checkins] = await Promise.all([
    readClubs(), readPages((first, last) => receipts.range(first, last)),
    view.kind === "owner" ? readPages((first, last) => db().from("claims")
      .select("events!inner(id,name,starts_at,location,club_id,mint)").eq("wallet", wallet)
      .eq("status", "confirmed").is("revoked_at", null).is("events.mint", null)
      .order("event_id").range(first, last)) : null,
  ]);
  const clubs = new Map(clubList.map(c => [c.id, clubInfo(c)]));
  if (checkins?.error || receiptRows.error) partial = true;
  for (const row of checkins?.data ?? []) {
    const e = row.events as unknown as CheckinEvent;
    const club = clubs.get(e.club_id ?? LEGACY_CLUB_ID);
    if (club) events.push({ id: e.id, name: e.name, date: e.starts_at.slice(0, 16),
      ...(e.location ? { location: e.location } : {}), club, source: "checkin", mint: null,
      kind: "attendance", role: "Attendee" });
  }
  const rows = receiptRows.data ?? [];
  // Bound simultaneous RPC reads when independently checking the proofs for an opening.
  for (let i = 0; i < rows.length; i += 6) {
    await Promise.all(rows.slice(i, i + 6).map(async row => {
      const file = parseReceiptFile(row.receipt_file);
      const { record } = file;
      const issuer = fields(record.club);
      const event = fields(record.event);
      const person = fields(record.person);
      const club = typeof issuer?.id === "string" ? clubs.get(issuer.id) : undefined;
      if (!club || issuer?.issuer !== club.issuer || file.receipt.issuer !== club.issuer
        || record.kind !== "contribution" || person?.wallet !== wallet || !event || event.id !== row.event_id
        || typeof event.name !== "string" || typeof event.date !== "string" || !isRole(record.role)
        || record.role === "Attendee" || record.role !== row.role || recordHash(record, file.salt) !== file.receipt.hash) return;
      if (view.kind === "opening") {
        if (!club.verified) return;
        const proof = await verifyReceipt(file, getConnection(), club.issuer);
        if (!proof.ok) { if (proof.reason === "rpc_error" || proof.reason === "not_found") partial = true; return; }
      }
      events.push({ id: `${event.id}-${record.role}`, name: event.name, date: event.date,
        kind: "contribution", role: record.role, club, mint: null, source: "receipt", receiptFile: file });
    }));
  }
  return { events, partial };
}

/** Use only after wallet authentication or after checking the receiving club owns the application. */
export async function getPrivateProfile(owner: PublicKey, view: View): Promise<Profile> {
  const wallet = owner.toBase58();
  const [legacy, privateResult] = await Promise.allSettled([getProfile(owner), privateEvents(wallet, view)]);
  if (legacy.status === "rejected" && privateResult.status === "rejected") throw new Error("Record unavailable");
  const old = legacy.status === "fulfilled" ? legacy.value : null;
  const current = privateResult.status === "fulfilled" ? privateResult.value : null;
  const events = [...(old?.events ?? []), ...(current?.events ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const count = events.filter(e => e.kind === "attendance" && e.club.verified).length;
  const next = getNextTier(count);
  return {
    wallet, events, count, contributions: events.filter(e => e.kind === "contribution" && e.club.verified).length,
    tier: getTier(count)?.name ?? null, nextTier: next ? { ...next, remaining: next.min - count } : null,
    unverified: old?.unverified ?? [], unverifiedTotal: old?.unverifiedTotal ?? 0,
    ...(!old || !current || old.partial || current.partial ? { partial: true } : {}),
  };
}
