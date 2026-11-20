import { NextResponse } from "next/server";
import { ChatRateLimitError, chatActor, postMessage, readMessages } from "@/lib/server/chat";
import { CHAT_BODY_MAX, cleanText } from "@/lib/chat";
import { NO_STORE, chatError, chatFailure, validClubId } from "../../../_shared";

export const dynamic = "force-dynamic";

// The newest messages, or only the ones after ?after=<id> (the page polls every few seconds).
export async function GET(request: Request, { params }: { params: Promise<{ clubId: string; groupId: string }> }) {
  const { clubId, groupId } = await params;
  if (!validClubId(clubId)) return chatError("not_found", 404);
  const after = Number(new URL(request.url).searchParams.get("after")) || undefined;
  try {
    const actor = await chatActor(request, clubId);
    if (!actor) return chatError("unauthorized", 401);
    const messages = await readMessages(actor, groupId, after);
    return messages ? NextResponse.json({ messages }, { headers: NO_STORE }) : chatError("not_found", 404);
  } catch (e) {
    return chatFailure(e, "messages");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ clubId: string; groupId: string }> }) {
  const { clubId, groupId } = await params;
  if (!validClubId(clubId)) return chatError("not_found", 404);
  let body: Record<string, unknown>;
  try { body = (await request.json()) ?? {}; } catch { return chatError("invalid_input", 400); }
  const text = cleanText(body.body, CHAT_BODY_MAX, true);
  if (!text) return chatError("invalid_input", 400);
  try {
    const actor = await chatActor(request, clubId);
    if (!actor) return chatError("unauthorized", 401);
    const message = await postMessage(actor, groupId, text);
    return message ? NextResponse.json({ message }, { status: 201, headers: NO_STORE }) : chatError("not_found", 404);
  } catch (e) {
    if (e instanceof ChatRateLimitError) return chatError("slow_down", 429);
    return chatFailure(e, "post message");
  }
}
