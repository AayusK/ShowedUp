import { NextResponse } from "next/server";
import { isOrganizerAuthorized } from "@/lib/server/auth";
import { getEvent } from "@/lib/server/events";
import { currentCode } from "@/lib/server/code";

export const dynamic = "force-dynamic";

// The organizer screen polls this for the code to put in the QR.
// Password-protected, so attendees can't fetch codes without being in the room.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isOrganizerAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const event = await getEvent(id);
    if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(currentCode(event.id), { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "code_not_configured" }, { status: 500 });
  }
}
