import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getProfile } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

// Public: anyone can look up any wallet's attendance. That's the point of putting it on-chain.
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
