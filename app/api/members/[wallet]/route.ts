import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { hasMemberName } from "@/lib/server/members";

export const dynamic = "force-dynamic";

// Tells the claim screen whether to ask for a name. Answers yes/no only, never the name.
export async function GET(_request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  let key: PublicKey;
  try {
    key = new PublicKey(wallet);
  } catch {
    return NextResponse.json({ error: "invalid_wallet" }, { status: 400 });
  }
  try {
    return NextResponse.json({ known: await hasMemberName(key.toBase58()) });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
