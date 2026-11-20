import "server-only";
import { PublicKey } from "@solana/web3.js";
import { db } from "./db";
import { newId } from "./ids";
import { getClub, readClubs, type ClubRecord } from "./clubs";
import { getPrivateProfile } from "./privateProfile";
import { getProfile, type Profile } from "./profile";
import { isRole, type Role } from "@/lib/badges";
import {
  MIN_COUNT_MAX,
  MIN_COUNT_MIN,
  OPENING_ID_RE,
  badgesTowardRule,
  isClosed,
  type Applicant,
  type ApplicantSummary,
  type ApplicationStatus,
  type ClubOpening,
  type CountedBadge,
  type Decision,
  type OpeningInfo,
  type RuleCheck,
} from "@/lib/openings";

// Openings and applications (tables in db/03_openings.sql). An opening carries a rule; whether a
// wallet meets it is always worked out here on the server, from the wallet's badges on Solana.

interface OpeningRow {
  id: string;
  club_id: string;
  title: string;
  description: string | null;
  role: string | null;
  min_count: number;
  closes_at: string | null;
  created_at: string;
}

interface ApplicationRow {
  opening_id: string;
  wallet: string;
  status: string;
  created_at: string;
}

const COLUMNS = "id, club_id, title, description, role, min_count, closes_at, created_at";
// Postgres / PostgREST codes for "that table doesn't exist" (db/03_openings.sql hasn't been run).
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);
const UNIQUE_VIOLATION = "23505";

/** How many openings the public list reads and shows. */
const MAX_READ = 200;
const MAX_LISTED = 50;
/** How many counted badges are sent back in one answer. The count itself is never cut. */
const MAX_BADGES_LISTED = 50;
const MAX_BADGES_PER_APPLICANT = 6;
/**
 * Reading one applicant's track record costs a round of Solana RPC calls, so one request
 * summarises at most this many applicants, a few at a time rather than all at once.
 */
export const APPLICANTS_PER_PAGE = 25;
const SUMMARIES_AT_ONCE = 4;

function readStatus(value: string): ApplicationStatus {
  return value === "accepted" || value === "declined" ? value : "pending";
}

/**
 * Turns a database row into an opening. Returns null for a row whose rule we can't read (a role
 * outside the fixed list, or a count out of range): leaving it out is safer than guessing a
 * looser rule.
 */
function fromRow(r: OpeningRow, clubName: string): OpeningInfo | null {
  let role: Role | null = null;
  if (r.role) {
    if (!isRole(r.role)) return null;
    role = r.role;
  }
  if (!Number.isInteger(r.min_count) || r.min_count < MIN_COUNT_MIN || r.min_count > MIN_COUNT_MAX) return null;
  return {
    id: r.id,
    clubId: r.club_id,
    clubName,
    title: r.title,
    description: r.description || null,
    role,
    minCount: r.min_count,
    closesAt: r.closes_at,
    createdAt: r.created_at,
    closed: isClosed(r.closes_at),
  };
}

function withClubNames(rows: OpeningRow[], names: Map<string, string>): OpeningInfo[] {
  return rows.flatMap((r) => {
    const name = names.get(r.club_id);
    const opening = name ? fromRow(r, name) : null;
    return opening ? [opening] : [];
  });
}

export interface NewOpening {
  title: string;
  description: string | null;
  role: Role | null;
  minCount: number;
  closesAt: string | null;
}

/** Saves a new opening for this club. */
export async function createOpening(club: ClubRecord, fields: NewOpening): Promise<OpeningInfo> {
  // An opening points at its club's row. The default club's row is added the first time the
  // club list is read, so make sure that has happened.
  if (club.legacy) await readClubs();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await db().from("openings")
      .insert({
        id: newId(),
        club_id: club.id,
        title: fields.title,
        description: fields.description,
        role: fields.role,
        min_count: fields.minCount,
        closes_at: fields.closesAt,
      })
      .select(COLUMNS).single();
    if (!error) {
      const opening = fromRow(data as OpeningRow, club.name);
      if (!opening) throw new Error("opening insert failed: saved row could not be read back");
      return opening;
    }
    // 23505 = the random id was already in use: try another one.
    if (error.code !== UNIQUE_VIOLATION) throw new Error(`opening insert failed: ${error.message}`);
  }
  throw new Error("opening insert failed: could not find a free id");
}

/** One opening, or null if there is none with that id. Throws if the database can't be read. */
export async function getOpening(id: string): Promise<OpeningInfo | null> {
  if (!OPENING_ID_RE.test(id)) return null;
  const { data, error } = await db().from("openings").select(COLUMNS).eq("id", id).maybeSingle();
  if (error && MISSING_TABLE.has(error.code ?? "")) return null;
  if (error) throw new Error(`opening read failed: ${error.message}`);
  if (!data) return null;
  const row = data as OpeningRow;
  const club = await getClub(row.club_id);
  return club ? fromRow(row, club.name) : null;
}

/** Openings still taking applications, newest first. Public: no names, no applicants. */
export async function listOpenOpenings(): Promise<OpeningInfo[]> {
  const { data, error } = await db().from("openings").select(COLUMNS)
    .order("created_at", { ascending: false }).limit(MAX_READ);
  if (error && MISSING_TABLE.has(error.code ?? "")) return [];
  if (error) throw new Error(`openings read failed: ${error.message}`);
  const rows = data as OpeningRow[];
  if (rows.length === 0) return [];
  // Only verified clubs' openings are listed publicly; an unverified club's opening still opens
  // by its direct link.
  const verified = new Map((await readClubs()).filter((c) => c.verified).map((c) => [c.id, c.name]));
  return withClubNames(rows, verified).filter((o) => !o.closed).slice(0, MAX_LISTED);
}

/** Every opening of one club (open and closed), newest first, with how many people applied. */
export async function listClubOpenings(club: ClubRecord): Promise<ClubOpening[]> {
  const { data, error } = await db().from("openings").select(COLUMNS)
    .eq("club_id", club.id).order("created_at", { ascending: false }).limit(MAX_READ);
  if (error) throw new Error(`openings read failed: ${error.message}`);
  const openings = withClubNames(data as OpeningRow[], new Map([[club.id, club.name]]));
  if (openings.length === 0) return [];

  const { data: apps, error: appError } = await db().from("applications")
    .select("opening_id, status").in("opening_id", openings.map((o) => o.id));
  if (appError) throw new Error(`applications read failed: ${appError.message}`);
  const counts = new Map<string, { applications: number; pending: number }>();
  for (const a of apps as Pick<ApplicationRow, "opening_id" | "status">[]) {
    const c = counts.get(a.opening_id) ?? { applications: 0, pending: 0 };
    c.applications += 1;
    if (readStatus(a.status) === "pending") c.pending += 1;
    counts.set(a.opening_id, c);
  }
  return openings.map((o) => ({ ...o, ...(counts.get(o.id) ?? { applications: 0, pending: 0 }) }));
}

// ---- The rule -----------------------------------------------------------------------------

function toCounted(e: Profile["events"][number]): CountedBadge {
  return { name: e.name, club: e.club.name, role: e.role, date: e.date, mint: e.mint, ...(e.receiptFile ? { receiptFile: e.receiptFile } : {}) };
}

/**
 * Checks a rule against a track record that was just read from Solana. `profile.events` holds
 * only verified badges (tokens the wallet holds whose issuer is a verified club), so a look-alike
 * token from anyone else never counts.
 */
function evaluate(opening: Pick<OpeningInfo, "role" | "minCount">, profile: Profile) {
  const matched = badgesTowardRule(profile.events, opening.role);
  return {
    matched,
    counted: matched.length,
    qualifies: matched.length >= opening.minCount,
    remaining: Math.max(0, opening.minCount - matched.length),
  };
}

/**
 * Does this wallet meet the opening's rule? Reads the wallet's badges from the blockchain
 * (getProfile) every time it is asked, so the answer can't be faked by the browser and reflects
 * the record as it is right now. Throws if Solana can't be reached.
 */
export async function checkRule(opening: Pick<OpeningInfo, "role" | "minCount">, owner: PublicKey, includeReceipts = false): Promise<RuleCheck> {
  const profile = includeReceipts ? await getPrivateProfile(owner, { kind: "opening", role: opening.role }) : await getProfile(owner);
  const { matched, counted, qualifies, remaining } = evaluate(opening, profile);
  return {
    qualifies,
    counted,
    needed: opening.minCount,
    remaining,
    badges: matched.slice(0, MAX_BADGES_LISTED).map(toCounted),
    ...(profile.partial ? { partial: true } : {}),
  };
}

// ---- Applications -------------------------------------------------------------------------

/** The status of this wallet's application to this opening, or null if it hasn't applied. */
export async function getApplicationStatus(openingId: string, wallet: string): Promise<ApplicationStatus | null> {
  const { data, error } = await db().from("applications").select("status")
    .eq("opening_id", openingId).eq("wallet", wallet).maybeSingle();
  if (error) throw new Error(`application read failed: ${error.message}`);
  return data ? readStatus((data as Pick<ApplicationRow, "status">).status) : null;
}

/**
 * Records an application. It is a plain insert, never an update: the table's primary key is
 * (opening, wallet), so a second application from the same wallet is refused by the database
 * ("exists") and can neither create a duplicate nor reset a decision already made.
 */
export async function insertApplication(openingId: string, wallet: string): Promise<"created" | "exists"> {
  const { error } = await db().from("applications").insert({ opening_id: openingId, wallet });
  if (!error) return "created";
  if (error.code === UNIQUE_VIOLATION) return "exists";
  throw new Error(`application insert failed: ${error.message}`);
}

/** Sets an officer's decision. Returns false if that wallet never applied to that opening. */
export async function decideApplication(openingId: string, wallet: string, decision: Decision): Promise<boolean> {
  const { data, error } = await db().from("applications").update({ status: decision })
    .eq("opening_id", openingId).eq("wallet", wallet).select("wallet").maybeSingle();
  if (error) throw new Error(`application update failed: ${error.message}`);
  return !!data;
}

/** Reads one applicant's badges from Solana and sums up what counted. null if that read failed. */
async function summarise(opening: Pick<OpeningInfo, "role" | "minCount">, wallet: string, appliedAt: string): Promise<ApplicantSummary | null> {
  try {
    const profile = await getPrivateProfile(new PublicKey(wallet), { kind: "opening", role: opening.role, appliedAt });
    if (profile.partial) return null;
    const { matched, counted, qualifies } = evaluate(opening, profile);
    const perClub = new Map<string, number>();
    for (const e of matched) perClub.set(e.club.name, (perClub.get(e.club.name) ?? 0) + 1);
    return {
      counted,
      qualifies,
      byClub: [...perClub].map(([club, count]) => ({ club, count })).sort((a, b) => b.count - a.count),
      badges: matched.slice(0, MAX_BADGES_PER_APPLICANT).map(toCounted),
    };
  } catch (e) {
    console.error("[openings] applicant summary failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return null;
  }
}

/**
 * One page of an opening's applicants, oldest first, for that club's officers only: saved names
 * (applying was the student's consent to share it with this club) and a summary of each record.
 * At most APPLICANTS_PER_PAGE are returned per call; `total` says how many there are in all.
 */
export async function listApplicants(
  opening: Pick<OpeningInfo, "id" | "role" | "minCount">,
  offset: number,
): Promise<{ applicants: Applicant[]; total: number }> {
  const { data, error, count } = await db().from("applications")
    .select("wallet, status, created_at", { count: "exact" })
    .eq("opening_id", opening.id)
    .order("created_at", { ascending: true }).order("wallet", { ascending: true })
    .range(offset, offset + APPLICANTS_PER_PAGE - 1);
  if (error) throw new Error(`applications read failed: ${error.message}`);
  const rows = (data as Pick<ApplicationRow, "wallet" | "status" | "created_at">[]).slice(0, APPLICANTS_PER_PAGE);
  if (rows.length === 0) return { applicants: [], total: count ?? 0 };

  const { data: members, error: memberError } = await db().from("members")
    .select("wallet, name").in("wallet", rows.map((r) => r.wallet));
  if (memberError) throw new Error(`member read failed: ${memberError.message}`);
  const names = new Map((members ?? []).map((m) => [m.wallet as string, m.name as string]));

  // A few track records at a time, so one request never fires dozens of RPC calls together.
  const summaries: (ApplicantSummary | null)[] = [];
  for (let i = 0; i < rows.length; i += SUMMARIES_AT_ONCE) {
    const batch = rows.slice(i, i + SUMMARIES_AT_ONCE);
    summaries.push(...(await Promise.all(batch.map((r) => summarise(opening, r.wallet, r.created_at)))));
  }

  return {
    applicants: rows.map((r, i) => ({
      wallet: r.wallet,
      name: names.get(r.wallet) ?? null,
      status: readStatus(r.status),
      appliedAt: r.created_at,
      summary: summaries[i],
    })),
    total: count ?? rows.length,
  };
}
