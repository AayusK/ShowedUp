import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { authorizePrivateRead } from "@/lib/server/privateAccess";
import { getPrivateProfile } from "@/lib/server/privateProfile";
import { getProfile } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

// Public profiles show the wallet’s legacy on-chain badges.
export async function GET(_request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  let owner: PublicKey;
  try {
    owner = new PublicKey(wallet);
  } catch {
    return NextResponse.json({ error: "invalid_wallet" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getProfile(owner), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[api/profile] lookup failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return NextResponse.json({ error: "rpc_error" }, { status: 502 });
  }
}

/** A private response includes this wallet's check-ins and downloadable contribution files. */
export async function POST(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const owner = await authorizePrivateRead(request, "profile", wallet);
  const headers = { "cache-control": "private, no-store" };
  if (!owner) return NextResponse.json({ error: "bad_signature" }, { status: 401, headers });
  try {
    return NextResponse.json(await getPrivateProfile(owner, { kind: "owner" }), { headers });
  } catch {
    return NextResponse.json({ error: "record_unavailable" }, { status: 503, headers });
  }
}
