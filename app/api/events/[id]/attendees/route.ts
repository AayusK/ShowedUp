import { NextResponse } from "next/server";
import { isOrganizerAuthorized } from "@/lib/server/auth";
import { eventAttendees } from "@/lib/server/members";

export const dynamic = "force-dynamic";

// The check-in screen polls this for its "Who's here" list. Password-protected: names are
// only for the organizer's screen.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isOrganizerAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const attendees = await eventAttendees(id);
    return NextResponse.json({ attendees }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[api/attendees] read failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
