import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { verifyWalletSignature } from "@/lib/server/claim";
import { ProfilesNotReadyError, ownCard, publicCard, saveCard } from "@/lib/server/profileCards";
import { cardReadMessage, cardSaveMessage, cleanCard } from "@/lib/profileCard";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
/** A signature must be this fresh. */
const MAX_AGE_MS = 10 * 60_000;

function error(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, ...extra }, { status, headers: NO_STORE });
}

function validWallet(raw: string): string | null {
  try { return new PublicKey(raw).toBase58() === raw ? raw : null; } catch { return null; }
}

function fresh(signedAt: unknown): signedAt is string {
  if (typeof signedAt !== "string") return false;
  const t = Date.parse(signedAt);
  return Number.isFinite(t) && Math.abs(Date.now() - t) <= MAX_AGE_MS;
}

// Public: the card shown on a track record, only once its owner switched it on.
export async function GET(_request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const wallet = validWallet((await params).wallet);
  if (!wallet) return error("invalid_wallet", 400);
  try {
    return NextResponse.json({ card: await publicCard(wallet) }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof ProfilesNotReadyError) return NextResponse.json({ card: null, ready: false }, { headers: NO_STORE });
    console.error("[api/profile-card] read failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("server_error", 500);
  }
}

// The owner reads their own card (even hidden) or saves it. Both need a fresh wallet signature.
export async function POST(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const wallet = validWallet((await params).wallet);
  if (!wallet) return error("invalid_wallet", 400);
  let body: Record<string, unknown>;
  try { body = (await request.json()) ?? {}; } catch { return error("invalid_input", 400); }
  const { action, signedAt, signature } = body;
  if (typeof signature !== "string" || !fresh(signedAt)) return error("stale_signature", 401);

  try {
    if (action === "read") {
      if (!verifyWalletSignature(wallet, cardReadMessage(wallet, signedAt), signature)) return error("bad_signature", 401);
      return NextResponse.json({ card: await ownCard(wallet) }, { headers: NO_STORE });
    }
    if (action === "save") {
      const cleaned = cleanCard(body.card);
      if (!cleaned.ok) return error("invalid_input", 400, { message: cleaned.message });
      // The browser signs the cleaned card it sent; anything the server would change fails here.
      if (!verifyWalletSignature(wallet, cardSaveMessage(wallet, signedAt, cleaned.card), signature)) return error("bad_signature", 401);
      if (!(await saveCard(wallet, cleaned.card, signedAt))) return error("stale_signature", 409);
      return NextResponse.json({ card: cleaned.card }, { headers: NO_STORE });
    }
    return error("invalid_input", 400);
  } catch (e) {
    if (e instanceof ProfilesNotReadyError) return error("schema_not_ready", 503);
    console.error("[api/profile-card] save failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("server_error", 500);
  }
}
