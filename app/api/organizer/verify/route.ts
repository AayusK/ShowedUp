import { NextResponse } from "next/server";
import { isOrganizerAuthorized } from "@/lib/server/auth";

// Lets the organizer page check the password before showing organizer actions.
export async function POST(request: Request) {
  if (!isOrganizerAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
