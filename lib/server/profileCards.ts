import "server-only";
import { db } from "./db";
import { EMPTY_CARD, type ProfileCard } from "@/lib/profileCard";

// Postgres / PostgREST codes for "that table doesn't exist": db/07_profiles.sql hasn't been run.
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

export class ProfilesNotReadyError extends Error {}

interface Row {
  wallet: string; display_name: string | null; headline: string | null; school: string | null; major: string | null;
  grad_year: number | null; bio: string | null; links: unknown; skills: unknown; is_public: boolean; signed_at: string | null;
}

function fromRow(r: Row): ProfileCard {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    ...EMPTY_CARD,
    displayName: r.display_name ?? "", headline: r.headline ?? "", school: r.school ?? "", major: r.major ?? "",
    gradYear: r.grad_year, bio: r.bio ?? "", links: list(r.links), skills: list(r.skills), isPublic: r.is_public,
  };
}

async function readRow(wallet: string): Promise<Row | null> {
  const { data, error } = await db().from("profiles").select("*").eq("wallet", wallet).maybeSingle();
  if (error && MISSING_TABLE.has(error.code ?? "")) throw new ProfilesNotReadyError();
  if (error) throw new Error(`profile read failed: ${error.message}`);
  return (data as Row | null) ?? null;
}

/** The card as anyone may see it: only when the student switched it on. */
export async function publicCard(wallet: string): Promise<ProfileCard | null> {
  const row = await readRow(wallet);
  return row && row.is_public ? fromRow(row) : null;
}

/** The card for its owner (already proven with a signature), shown or not. */
export async function ownCard(wallet: string): Promise<ProfileCard> {
  const row = await readRow(wallet);
  return row ? fromRow(row) : EMPTY_CARD;
}

/**
 * Saves a card. `signedAt` must be newer than the last save, so an old signed update can't be
 * replayed to undo a newer one. Returns false if it's stale.
 */
export async function saveCard(wallet: string, card: ProfileCard, signedAt: string): Promise<boolean> {
  const row = await readRow(wallet);
  if (row?.signed_at && Date.parse(row.signed_at) >= Date.parse(signedAt)) return false;
  const { error } = await db().from("profiles").upsert({
    wallet, display_name: card.displayName || null, headline: card.headline || null, school: card.school || null,
    major: card.major || null, grad_year: card.gradYear, bio: card.bio || null, links: card.links, skills: card.skills,
    is_public: card.isPublic, signed_at: signedAt, updated_at: new Date().toISOString(),
  });
  if (error && MISSING_TABLE.has(error.code ?? "")) throw new ProfilesNotReadyError();
  if (error) throw new Error(`profile save failed: ${error.message}`);
  return true;
}
