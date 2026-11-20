import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { verifyWalletSignature } from "@/lib/server/claim";
import { issueMemberToken, memberDirectory } from "@/lib/server/chat";
import { chatSignInMessage } from "@/lib/chat";
import { NO_STORE, chatError, chatFailure, validClubId } from "../_shared";

export const dynamic = "force-dynamic";

// A member opens their club's chat: they sign a short message with their wallet, and if they
// checked in to this club themselves they get a 7-day chat token. Officers don't need this.
export async function POST(request: Request, { params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  if (!validClubId(clubId)) return chatError("not_found", 404);
  let body: Record<string, unknown>;
  try { body = (await request.json()) ?? {}; } catch { return chatError("invalid_input", 400); }
  const { wallet, signedAt, signature } = body;
  if (typeof wallet !== "string" || typeof signedAt !== "string" || typeof signature !== "string") return chatError("invalid_input", 400);
  try { if (new PublicKey(wallet).toBase58() !== wallet) return chatError("invalid_wallet", 400); } catch { return chatError("invalid_wallet", 400); }
  const t = Date.parse(signedAt);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > 10 * 60_000) return chatError("stale_signature", 401);
  if (!verifyWalletSignature(wallet, chatSignInMessage(clubId, wallet, signedAt), signature)) return chatError("bad_signature", 401);
  try {
    const name = (await memberDirectory(clubId)).get(wallet);
    if (!name) return chatError("not_member", 403);
    return NextResponse.json({ ...issueMemberToken(wallet, clubId), name }, { headers: NO_STORE });
  } catch (e) {
    return chatFailure(e, "session");
  }
}
