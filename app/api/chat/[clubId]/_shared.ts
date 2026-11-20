import { NextResponse } from "next/server";
import { CLUB_ID_RE, LEGACY_CLUB_ID } from "@/lib/clubs";
import { ChatNotReadyError } from "@/lib/server/chat";

export const NO_STORE = { "cache-control": "no-store" };

export function chatError(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, ...extra }, { status, headers: NO_STORE });
}

export function validClubId(id: string): boolean {
  return id === LEGACY_CLUB_ID || CLUB_ID_RE.test(id);
}

/** Shared error mapping: a missing table means db/08_chat.sql hasn't been run. */
export function chatFailure(e: unknown, where: string) {
  if (e instanceof ChatNotReadyError) return chatError("schema_not_ready", 503);
  console.error(`[api/chat] ${where} failed:`, e instanceof Error ? e.message.split("\n")[0] : "unknown");
  return chatError("server_error", 500);
}
