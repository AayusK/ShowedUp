import { NextResponse } from "next/server";
import { chatActor, createGroup, listGroups } from "@/lib/server/chat";
import { GROUP_NAME_MAX, GROUP_PURPOSE_MAX, cleanText } from "@/lib/chat";
import { NO_STORE, chatError, chatFailure, validClubId } from "../_shared";

export const dynamic = "force-dynamic";

// The groups this person can see (officers: all; members: Everyone + their groups).
export async function GET(request: Request, { params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  if (!validClubId(clubId)) return chatError("not_found", 404);
  try {
    const actor = await chatActor(request, clubId);
    if (!actor) return chatError("unauthorized", 401);
    return NextResponse.json({ groups: await listGroups(actor), me: { kind: actor.kind, name: actor.name } }, { headers: NO_STORE });
  } catch (e) {
    return chatFailure(e, "groups");
  }
}

// Officers create a group for a job and pick its members from the club's member list.
export async function POST(request: Request, { params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  if (!validClubId(clubId)) return chatError("not_found", 404);
  let body: Record<string, unknown>;
  try { body = (await request.json()) ?? {}; } catch { return chatError("invalid_input", 400); }
  const name = cleanText(body.name, GROUP_NAME_MAX);
  const purpose = cleanText(body.purpose, GROUP_PURPOSE_MAX);
  const wallets = Array.isArray(body.members) ? body.members.filter((w): w is string => typeof w === "string") : [];
  if (!name) return chatError("invalid_input", 400, { message: "Give the group a name." });
  try {
    const actor = await chatActor(request, clubId);
    if (!actor) return chatError("unauthorized", 401);
    if (actor.kind !== "officer") return chatError("officers_only", 403);
    return NextResponse.json({ id: await createGroup(clubId, name, purpose, wallets) }, { status: 201, headers: NO_STORE });
  } catch (e) {
    return chatFailure(e, "create group");
  }
}
