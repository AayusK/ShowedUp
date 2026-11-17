import { NextResponse } from "next/server";
import { getOpening } from "@/lib/server/openings";
import { OPENING_ID_RE } from "@/lib/openings";

export const dynamic = "force-dynamic";

// Public: one opening (title, club, rule, closing date). No names, no applicants.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!OPENING_ID_RE.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const opening = await getOpening(id);
    if (!opening) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ opening }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[api/openings] read failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
