import { NextResponse } from "next/server";
import { authorizeClub } from "@/lib/server/auth";
import { createOpening, listClubOpenings, listOpenOpenings } from "@/lib/server/openings";
import { isRole, type Role } from "@/lib/badges";
import { MIN_COUNT_MAX, MIN_COUNT_MIN, OPENING_DESCRIPTION_MAX, OPENING_TITLE_MAX } from "@/lib/openings";

export const dynamic = "force-dynamic";

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

function error(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, ...extra }, { status });
}

/** Trims, collapses spaces and strips control characters (line breaks are kept when `multiline`). */
function cleanText(raw: unknown, multiline = false): string {
  if (typeof raw !== "string") return "";
  const text = raw.replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, "");
  return multiline
    ? text.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
    : text.replace(/\s+/g, " ").trim();
}

// Public: the openings still taking applications (title, club, rule). No names, no applicants.
// With `?mine=1` and a club's passcode: every opening of that club, with application counts.
export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  if (new URL(request.url).searchParams.get("mine") === "1") {
    let club;
    try {
      club = await authorizeClub(request);
    } catch {
      return error("server_not_configured", 500);
    }
    if (!club) return error("unauthorized", 401);
    try {
      return NextResponse.json({ openings: await listClubOpenings(club) }, { headers });
    } catch (e) {
      console.error("[api/openings] club list failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
      return error("server_error", 500);
    }
  }
  try {
    return NextResponse.json({ openings: await listOpenOpenings() }, { headers });
  } catch (e) {
    console.error("[api/openings] list failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("server_error", 500);
  }
}

// A club's officer posts an opening. Needs that club's passcode; the opening belongs to that club.
export async function POST(request: Request) {
  let club;
  try {
    club = await authorizeClub(request);
  } catch {
    return error("server_not_configured", 500);
  }
  if (!club) return error("unauthorized", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("invalid_input", 400, { message: "Body must be JSON" });
  }
  const fields = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  if (typeof fields.title === "string" && fields.title.length > OPENING_TITLE_MAX * 4) {
    return error("invalid_input", 400, { message: `The title is too long (max ${OPENING_TITLE_MAX} characters)` });
  }
  const title = cleanText(fields.title);
  if (!title || title.length > OPENING_TITLE_MAX) {
    return error("invalid_input", 400, { message: `A title is required (max ${OPENING_TITLE_MAX} characters)` });
  }

  if (fields.description != null && typeof fields.description !== "string") {
    return error("invalid_input", 400, { message: "The description must be text" });
  }
  const description = cleanText(fields.description, true);
  if (description.length > OPENING_DESCRIPTION_MAX) {
    return error("invalid_input", 400, { message: `The description is too long (max ${OPENING_DESCRIPTION_MAX} characters)` });
  }

  // An empty role means "a verified badge of any role". Anything else must be on the fixed list.
  let role: Role | null = null;
  if (fields.role != null && fields.role !== "") {
    if (!isRole(fields.role)) return error("invalid_input", 400, { message: "Pick a role from the list" });
    role = fields.role;
  }

  const minCount = fields.minCount;
  if (typeof minCount !== "number" || !Number.isInteger(minCount) || minCount < MIN_COUNT_MIN || minCount > MIN_COUNT_MAX) {
    return error("invalid_input", 400, { message: `The number of badges must be between ${MIN_COUNT_MIN} and ${MIN_COUNT_MAX}` });
  }

  let closesAt: string | null = null;
  if (fields.closesAt != null && fields.closesAt !== "") {
    const at = typeof fields.closesAt === "string" && ISO_RE.test(fields.closesAt) ? Date.parse(fields.closesAt) : NaN;
    if (!Number.isFinite(at)) return error("invalid_input", 400, { message: "The closing date isn’t a valid date" });
    if (at <= Date.now()) return error("invalid_input", 400, { message: "The closing date must be in the future" });
    if (at > Date.now() + TWO_YEARS_MS) return error("invalid_input", 400, { message: "The closing date is too far away (max 2 years)" });
    closesAt = new Date(at).toISOString();
  }

  try {
    const opening = await createOpening(club, { title, description: description || null, role, minCount, closesAt });
    return NextResponse.json({ opening }, { status: 201 });
  } catch (e) {
    console.error("[api/openings] saving opening failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("save_failed", 500);
  }
}
