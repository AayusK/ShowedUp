import { NextResponse } from "next/server";
import { readFeed } from "@/lib/server/feed";
import type { FeedResponse } from "@/lib/feed";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Public: the most recent badges seen on Solana across verified clubs. No names, short wallets.
export async function GET() {
  try {
    return NextResponse.json(await readFeed(), { headers: NO_STORE });
  } catch (e) {
    // Database unreachable or not configured: the home page simply shows the feed as resting.
    console.error("[api/feed] feed unavailable:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    const off: FeedResponse = { items: [], stream: "off" };
    return NextResponse.json(off, { headers: NO_STORE });
  }
}
