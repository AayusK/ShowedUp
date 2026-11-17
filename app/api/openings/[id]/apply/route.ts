import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { verifyWalletSignature } from "@/lib/server/claim";
import { hasMemberName, saveMemberName } from "@/lib/server/members";
import { checkRule, getApplicationStatus, getOpening, insertApplication } from "@/lib/server/openings";
import { OPENING_ID_RE, applyMessage } from "@/lib/openings";
import { cleanName } from "@/lib/memberName";

export const dynamic = "force-dynamic";

function error(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}

// The only thing a student can write: an application to an opening, and only with a signature
// from the applying wallet.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!OPENING_ID_RE.test(id)) return error("not_found", 404);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return error("invalid_input", 400);
  }
  const { wallet, signature } = body;
  if (typeof wallet !== "string" || typeof signature !== "string" || wallet.length > 64 || signature.length > 128) {
    return error("invalid_input", 400);
  }
  if (body.name != null && (typeof body.name !== "string" || body.name.length > 400)) return error("invalid_input", 400);

  let owner: PublicKey;
  try {
    owner = new PublicKey(wallet);
    // A real wallet address is a point on the Ed25519 curve (program-derived addresses aren't).
    if (!PublicKey.isOnCurve(owner.toBytes())) return error("invalid_wallet", 400);
  } catch {
    return error("invalid_wallet", 400);
  }
  const wallet58 = owner.toBase58();

  // 1. The opening exists and is still taking applications.
  let opening;
  try {
    opening = await getOpening(id);
  } catch (e) {
    console.error("[api/openings/apply] opening read failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("server_error", 500);
  }
  if (!opening) return error("not_found", 404);

  // 2. The applicant controls this wallet: they signed the exact apply message with it. The
  //    server rebuilds the message itself, so a signature made for another opening or another
  //    wallet doesn't pass. Signing is free and puts nothing on the blockchain.
  if (!verifyWalletSignature(wallet58, applyMessage(opening.id, wallet58), signature)) return error("bad_signature", 401);

  try {
    // 3. One application per wallet. Someone who already applied gets their current status back
    //    (they proved the wallet is theirs), and nothing is written.
    const existing = await getApplicationStatus(opening.id, wallet58);
    if (existing) return NextResponse.json({ status: "already_applied", application: existing });

    if (opening.closed) return NextResponse.json({ status: "closed" });

    // 4. Applying shares the saved name with this club's officers, so there must be one. A name
    //    already on file is never replaced here: the apply message can be signed once and sent
    //    again later, and that must not be a way to rename someone.
    const name = cleanName(body.name);
    const needsName = !(await hasMemberName(wallet58));
    if (needsName && !name) return error("name_required", 400);

    // 5. The rule, checked again here from the wallet's badges on Solana. The page's own
    //    "you qualify" is never trusted.
    let check;
    try {
      check = await checkRule(opening, owner);
    } catch (e) {
      console.error("[api/openings/apply] track record read failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
      return error("rpc_error", 502);
    }
    if (!check.qualifies) {
      // Part of the record couldn't be read (database or RPC hiccup): say so rather than
      // telling someone who may well qualify that they don't.
      if (check.partial) return error("rpc_error", 502);
      return NextResponse.json({ status: "not_qualified", counted: check.counted, needed: check.needed, remaining: check.remaining });
    }

    // 6. Save the name (only now that the signature and the rule both checked out), then the
    //    application. The database's primary key refuses a second row for the same wallet.
    if (needsName) await saveMemberName(wallet58, name);
    const result = await insertApplication(opening.id, wallet58);
    if (result === "exists") {
      return NextResponse.json({ status: "already_applied", application: (await getApplicationStatus(opening.id, wallet58)) ?? "pending" });
    }
    return NextResponse.json({ status: "applied" }, { status: 201 });
  } catch (e) {
    console.error("[api/openings/apply] apply failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
    return error("server_error", 500);
  }
}
