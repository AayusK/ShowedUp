import "server-only";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "crypto";
import { Keypair } from "@solana/web3.js";
import { db } from "./db";
import { newId } from "./ids";
import { getOrganizerKeypair } from "./organizer";
import { CLUB_ID_RE, LEGACY_CLUB_ID, LEGACY_CLUB_NAME, PASSCODE_MAX, type ClubInfo } from "@/lib/clubs";

// The club registry. Every club issues badges from its own Solana wallet, and anyone can see on
// the chain which wallet issued a badge. This file keeps the list of clubs, works out each club's
// wallet, and checks club passcodes.

export interface ClubRecord extends ClubInfo {
  createdAt: string | null;
  /** True for the default club (events from before clubs existed). Its wallet is the organizer wallet. */
  legacy: boolean;
}

interface ClubRow {
  id: string;
  name: string;
  issuer: string;
  verified: boolean;
  created_at: string;
}

const COLUMNS = "id, name, issuer, verified, created_at";
// Postgres / PostgREST codes for "that table doesn't exist".
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

/** CLUB_KEY_SECRET is missing, too short, or no longer matches the address stored for a club. */
export class ClubKeyError extends Error {}
export class ClubNameTakenError extends Error {}

function organizerAddress(): string | null {
  try {
    return getOrganizerKeypair().publicKey.toBase58();
  } catch {
    return null;
  }
}

/**
 * The default club. It is built from code, not read from the database, so everything that
 * worked before clubs existed keeps working even if the `clubs` table can't be reached.
 */
export function legacyClub(row?: ClubRow | null): ClubRecord {
  return {
    id: LEGACY_CLUB_ID,
    name: LEGACY_CLUB_NAME,
    issuer: organizerAddress() ?? row?.issuer ?? "",
    verified: true,
    createdAt: row?.created_at ?? null,
    legacy: true,
  };
}

function fromRow(r: ClubRow): ClubRecord {
  return { id: r.id, name: r.name, issuer: r.issuer, verified: r.verified, createdAt: r.created_at, legacy: false };
}

export function clubInfo(c: ClubRecord): ClubInfo {
  return { id: c.id, name: c.name, issuer: c.issuer, verified: c.verified };
}

// ---- Club wallets -------------------------------------------------------------------------

function clubKeySecret(): string {
  const s = process.env.CLUB_KEY_SECRET;
  if (!s) throw new ClubKeyError("CLUB_KEY_SECRET is not set");
  if (s.length < 32) throw new ClubKeyError("CLUB_KEY_SECRET is too short (use at least 32 characters)");
  return s;
}

/**
 * A club's Solana keypair. It is never stored anywhere: it is worked out again each time from
 * CLUB_KEY_SECRET and the club's id (HMAC-SHA256 gives 32 bytes, and a Solana keypair is built
 * from exactly 32 secret bytes). Same idea as the rotating claim codes: nothing secret sits in
 * the database. Changing CLUB_KEY_SECRET changes every club's wallet, which orphans their badges.
 */
export function deriveClubKeypair(id: string): Keypair {
  const seed = createHmac("sha256", clubKeySecret()).update(`club:${id}`, "utf8").digest();
  return Keypair.fromSeed(seed);
}

/**
 * The keypair that signs as this club. The default club signs with the organizer wallet.
 * For every other club we check that the derived key still matches the address saved when the
 * club was created; if CLUB_KEY_SECRET was changed, we stop here instead of issuing from a
 * wallet nobody recognises.
 */
export function getClubKeypair(club: ClubRecord): Keypair {
  if (club.legacy) return getOrganizerKeypair();
  const keypair = deriveClubKeypair(club.id);
  if (keypair.publicKey.toBase58() !== club.issuer) {
    throw new ClubKeyError("CLUB_KEY_SECRET does not match this club's issuer address");
  }
  return keypair;
}

// ---- Reading and writing clubs ------------------------------------------------------------

let legacyRowSaved = false;

/** Adds the default club's row if it is missing. Never changes a row that is already there. */
async function ensureLegacyRow(): Promise<void> {
  if (legacyRowSaved) return;
  const issuer = organizerAddress();
  if (!issuer) return;
  const { error } = await db().from("clubs").upsert(
    { id: LEGACY_CLUB_ID, name: LEGACY_CLUB_NAME, issuer, verified: true },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (!error) legacyRowSaved = true;
}

/** Every club, the default club first. Throws if the `clubs` table can't be read. */
export async function readClubs(): Promise<ClubRecord[]> {
  await ensureLegacyRow();
  const { data, error } = await db().from("clubs").select(COLUMNS).order("created_at", { ascending: true });
  // Before db/01_clubs.sql is run there is no `clubs` table: the default club is the only club.
  if (error && MISSING_TABLE.has(error.code ?? "")) return [legacyClub()];
  if (error) throw new Error(`clubs read failed: ${error.message}`);
  const rows = data as ClubRow[];
  return [
    legacyClub(rows.find((r) => r.id === LEGACY_CLUB_ID)),
    ...rows.filter((r) => r.id !== LEGACY_CLUB_ID).map(fromRow),
  ];
}

export async function getClub(id: string): Promise<ClubRecord | null> {
  if (id === LEGACY_CLUB_ID) return legacyClub();
  if (!CLUB_ID_RE.test(id)) return null;
  const { data, error } = await db().from("clubs").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`club read failed: ${error.message}`);
  return data ? fromRow(data as ClubRow) : null;
}

/** Creates a club. Its wallet address is derived from the new id; only the address is saved. */
export async function createClub(name: string, passcode: string, verified: boolean): Promise<ClubRecord> {
  if (name.toLowerCase() === LEGACY_CLUB_NAME.toLowerCase()) throw new ClubNameTakenError();
  await ensureLegacyRow();
  const passcodeHash = await hashPasscode(passcode);
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newId();
    const issuer = deriveClubKeypair(id).publicKey.toBase58();
    const { data, error } = await db().from("clubs")
      .insert({ id, name, issuer, passcode_hash: passcodeHash, verified })
      .select(COLUMNS).single();
    if (!error) return fromRow(data as ClubRow);
    if (error.code !== "23505") throw new Error(`club insert failed: ${error.message}`); // 23505 = already exists
    if (/clubs_name_idx/.test(error.message)) throw new ClubNameTakenError();
    // Otherwise the random id was already in use: try another one.
  }
  throw new Error("club insert failed: could not find a free id");
}

/** Marks a club as verified (or not). Returns null if there is no such club. */
export async function setClubVerified(id: string, verified: boolean): Promise<ClubRecord | null> {
  if (id === LEGACY_CLUB_ID || !CLUB_ID_RE.test(id)) return null;
  const { data, error } = await db().from("clubs").update({ verified }).eq("id", id).select(COLUMNS).maybeSingle();
  if (error) throw new Error(`club update failed: ${error.message}`);
  return data ? fromRow(data as ClubRow) : null;
}

// ---- Club passcodes -----------------------------------------------------------------------

const KEY_BYTES = 32;
const SALT_BYTES = 16;
// Used when a club doesn't exist, so a wrong club id takes as long to answer as a wrong passcode.
const DUMMY_SALT = Buffer.alloc(SALT_BYTES, 7);

function scryptKey(passcode: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passcode, salt, KEY_BYTES, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * What we store instead of the passcode: "scrypt$<salt>$<hash>". scrypt is deliberately slow,
 * and every club gets its own random salt, so a leaked table can't be reversed by guessing fast.
 */
export async function hashPasscode(passcode: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptKey(passcode, salt);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Hashes the given passcode with the stored salt and compares in constant time. */
export async function verifyPasscode(passcode: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? "").split("$");
  const wellFormed = parts.length === 3 && parts[0] === "scrypt"
    && /^[0-9a-f]{32}$/.test(parts[1]) && /^[0-9a-f]{64}$/.test(parts[2]);
  const salt = wellFormed ? Buffer.from(parts[1], "hex") : DUMMY_SALT;
  const expected = wellFormed ? Buffer.from(parts[2], "hex") : Buffer.alloc(KEY_BYTES);
  const key = await scryptKey(passcode.slice(0, PASSCODE_MAX), salt);
  return timingSafeEqual(key, expected) && wellFormed;
}

/** The club, if `passcode` is that club's passcode. Not for the default club (see auth.ts). */
export async function checkClubPasscode(id: string, passcode: string): Promise<ClubRecord | null> {
  if (id === LEGACY_CLUB_ID || !CLUB_ID_RE.test(id)) {
    await verifyPasscode(passcode, null);
    return null;
  }
  const { data, error } = await db().from("clubs").select(`${COLUMNS}, passcode_hash`).eq("id", id).maybeSingle();
  if (error) throw new Error(`club read failed: ${error.message}`);
  const row = data as (ClubRow & { passcode_hash: string | null }) | null;
  const ok = await verifyPasscode(passcode, row?.passcode_hash);
  return ok && row ? fromRow(row) : null;
}
