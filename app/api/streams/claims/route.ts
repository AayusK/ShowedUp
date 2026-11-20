import { NextResponse } from "next/server";
import { gunzipSync } from "zlib";
import { extractDelivery, storeReceiptObservations, storeChainClaims, verifyStreamSignature } from "@/lib/server/streamClaims";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 20 * 1024 * 1024;

// Webhook for the QuickNode Stream (see lib/server/streamClaims.ts). Not for browsers: every
// request must carry QuickNode's signature, checked with QUICKNODE_STREAM_TOKEN.
export async function POST(request: Request) {
  const token = process.env.QUICKNODE_STREAM_TOKEN;
  if (!token) return NextResponse.json({ error: "stream_not_configured" }, { status: 503 });

  let raw: Buffer;
  try {
    raw = Buffer.from(await request.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  // QuickNode can gzip deliveries; the signature is over the unzipped text.
  let body: string;
  try {
    const zipped = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    body = (zipped ? gunzipSync(raw, { maxOutputLength: MAX_UNZIPPED_BYTES }) : raw).toString("utf8");
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const nonce = request.headers.get("x-qn-nonce") ?? "";
  const timestamp = request.headers.get("x-qn-timestamp") ?? "";
  const signature = request.headers.get("x-qn-signature") ?? "";
  if (!nonce || !timestamp || !verifyStreamSignature(token, nonce, timestamp, body, signature)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const { claims, receipts } = extractDelivery(payload);
  try {
    const [tokens, memos] = await Promise.all([storeChainClaims(claims), storeReceiptObservations(receipts)]);
    return NextResponse.json({ received: claims.length + receipts.length, stored: tokens.stored + memos.stored, ignored: tokens.ignored + memos.ignored });
  } catch (e) {
    // A non-2xx answer makes QuickNode retry the delivery, so nothing is lost.
    console.error("[api/streams/claims] store failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
