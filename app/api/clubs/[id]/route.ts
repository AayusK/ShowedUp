import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/server/auth";
import { clubInfo, setClubVerified } from "@/lib/server/clubs";

export const dynamic = "force-dynamic";

// Registry admin only (ORGANIZER_PASSWORD): mark a club as verified, or take that back.
// Only badges from verified clubs count on a track record.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const verified = ((body ?? {}) as Record<string, unknown>).verified;
  if (typeof verified !== "boolean") return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const club = await setClubVerified(id, verified);
    if (!club) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ club: clubInfo(club) });
  } catch (e) {
    console.error("[api/clubs] update failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
