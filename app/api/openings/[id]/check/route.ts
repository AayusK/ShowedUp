import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { authorizePrivateRead } from "@/lib/server/privateAccess";
import { checkRule, getOpening } from "@/lib/server/openings";
import { OPENING_ID_RE } from "@/lib/openings";

export const dynamic = "force-dynamic";

function error(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}

// Public: does this wallet meet this opening's rule? The server reads the wallet's badges from
// Solana and answers with the verified badges that counted. That is nothing more than the public
// track record page already shows for the same wallet: no names, and nothing about whether the
// wallet has applied.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!OPENING_ID_RE.test(id)) return error("not_found", 404);

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  let owner: PublicKey;
  try {
    owner = new PublicKey(wallet);
    // A real wallet address is a point on the Ed25519 curve (program-derived addresses aren't).
    if (!PublicKey.isOnCurve(owner.toBytes())) return error("invalid_wallet", 400);
  } catch {
    return error("invalid_wallet", 400);
  }

  return resultFor(id, owner, false);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!OPENING_ID_RE.test(id)) return error("not_found", 404);
  const owner = await authorizePrivateRead(request, `opening/${id}`);
  if (!owner) return error("bad_signature", 401);
  return resultFor(id, owner, true);
}

async function resultFor(id: string, owner: PublicKey, includeReceipts: boolean) {
  let opening;
  try {
    opening = await getOpening(id);
  } catch (e) {
    console.error("[api/openings/check] opening read failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("server_error", 500);
  }
  if (!opening) return error("not_found", 404);

  try {
    const check = await checkRule(opening, owner, includeReceipts);
    return NextResponse.json({ ...check, closed: opening.closed }, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    console.error("[api/openings/check] track record read failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("rpc_error", 502);
  }
}
