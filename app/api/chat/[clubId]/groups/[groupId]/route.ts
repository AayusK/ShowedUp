import { NextResponse } from "next/server";
import { chatActor, groupPeople, updateGroup } from "@/lib/server/chat";
import { NO_STORE, chatError, chatFailure, validClubId } from "../../_shared";

export const dynamic = "force-dynamic";

// Who is in this group (names only for people in the same club, as everywhere else).
export async function GET(request: Request, { params }: { params: Promise<{ clubId: string; groupId: string }> }) {
  const { clubId, groupId } = await params;
  if (!validClubId(clubId)) return chatError("not_found", 404);
  try {
    const actor = await chatActor(request, clubId);
    if (!actor) return chatError("unauthorized", 401);
    const people = await groupPeople(actor, groupId);
    if (!people) return chatError("not_found", 404);
    return NextResponse.json({ people }, { headers: NO_STORE });
  } catch (e) {
    return chatFailure(e, "group people");
  }
}

// Officers add or remove people, or archive the group. The Everyone group can't be changed.
export async function PATCH(request: Request, { params }: { params: Promise<{ clubId: string; groupId: string }> }) {
  const { clubId, groupId } = await params;
  if (!validClubId(clubId)) return chatError("not_found", 404);
  let body: Record<string, unknown>;
  try { body = (await request.json()) ?? {}; } catch { return chatError("invalid_input", 400); }
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((w): w is string => typeof w === "string").slice(0, 200) : undefined);
  try {
    const actor = await chatActor(request, clubId);
    if (!actor) return chatError("unauthorized", 401);
    if (actor.kind !== "officer") return chatError("officers_only", 403);
    const ok = await updateGroup(actor, groupId, { add: list(body.add), remove: list(body.remove), archive: body.archive === true });
    return ok ? NextResponse.json({ ok: true }, { headers: NO_STORE }) : chatError("not_found", 404);
  } catch (e) {
    return chatFailure(e, "update group");
  }
}
