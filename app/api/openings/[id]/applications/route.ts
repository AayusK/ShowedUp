import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { authorizeClub } from "@/lib/server/auth";
import type { ClubRecord } from "@/lib/server/clubs";
import { decideApplication, getOpening, listApplicants } from "@/lib/server/openings";
import { DECISIONS, OPENING_ID_RE, type Decision, type OpeningInfo } from "@/lib/openings";

export const dynamic = "force-dynamic";

function error(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}

/**
 * Both actions here are for the officers of the club that owns the opening: the request must
 * carry that club's passcode, and the opening's club must be that same club. Another club's
 * opening answers exactly like a wrong passcode.
 */
async function authorizeForOpening(request: Request, id: string): Promise<{ opening: OpeningInfo; club: ClubRecord } | NextResponse> {
  let club;
  try {
    club = await authorizeClub(request);
  } catch {
    return error("server_not_configured", 500);
  }
  if (!club) return error("unauthorized", 401);
  if (!OPENING_ID_RE.test(id)) return error("not_found", 404);
  let opening;
  try {
    opening = await getOpening(id);
  } catch (e) {
    console.error("[api/openings/applications] opening read failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("server_error", 500);
  }
  if (!opening) return error("not_found", 404);
  if (opening.clubId !== club.id) return error("unauthorized", 401);
  return { opening, club };
}

// Officers of the opening's club: one page of applicants with saved names and a summary of each
// track record. `?offset=` moves through the list (each call reads a limited number of records).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const allowed = await authorizeForOpening(request, id);
  if (allowed instanceof NextResponse) return allowed;

  const rawOffset = new URL(request.url).searchParams.get("offset") ?? "0";
  if (!/^\d{1,5}$/.test(rawOffset)) return error("invalid_input", 400);
  try {
    const page = await listApplicants(allowed.opening, Number(rawOffset));
    return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[api/openings/applications] read failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("server_error", 500);
  }
}

// Officers of the opening's club: accept or decline one application.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const allowed = await authorizeForOpening(request, id);
  if (allowed instanceof NextResponse) return allowed;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return error("invalid_input", 400);
  }
  const { wallet, status } = body;
  if (typeof wallet !== "string" || wallet.length > 64) return error("invalid_input", 400);
  if (typeof status !== "string" || !(DECISIONS as readonly string[]).includes(status)) return error("invalid_input", 400);

  let wallet58: string;
  try {
    const key = new PublicKey(wallet);
    // A real wallet address is a point on the Ed25519 curve (program-derived addresses aren't).
    if (!PublicKey.isOnCurve(key.toBytes())) return error("invalid_wallet", 400);
    wallet58 = key.toBase58();
  } catch {
    return error("invalid_wallet", 400);
  }

  try {
    const found = await decideApplication(allowed.opening.id, wallet58, status as Decision);
    if (!found) return error("not_found", 404);
    return NextResponse.json({ wallet: wallet58, status });
  } catch (e) {
    console.error("[api/openings/applications] decision failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("server_error", 500);
  }
}
