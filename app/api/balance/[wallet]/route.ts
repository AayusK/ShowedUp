import { NextResponse } from "next/server";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getConnection, withRetry } from "@/lib/server/mint";

export const dynamic = "force-dynamic";

// The header's wallet button asks here for the devnet SOL balance, so the browser
// never needs the server's RPC URL (and its API key).
export async function GET(_request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  let owner: PublicKey;
  try {
    owner = new PublicKey(wallet);
  } catch {
    return NextResponse.json({ error: "invalid_wallet" }, { status: 400 });
  }
  try {
    const lamports = await withRetry(() => getConnection().getBalance(owner, "confirmed"));
    return NextResponse.json({ sol: lamports / LAMPORTS_PER_SOL }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "rpc_error" }, { status: 502 });
  }
}
