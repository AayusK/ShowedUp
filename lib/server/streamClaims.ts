import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { db } from "./db";
import { parseReceiptFile } from "@/lib/receipt";
import { verifyDevnetReceipt } from "./receipts";
import { readEvents } from "./events";

// Live claim feed. A QuickNode Stream watches every new Solana devnet block, keeps the
// transactions where our organizer handed out an attendance token (streams/claims-filter.js)
// and POSTs them to /api/streams/claims. We store them in `chain_claims`, so the app learns
// about claims from the chain as they happen instead of asking Solana over and over.

export interface StreamClaim {
  /** The transaction that minted the token. */
  signature: string;
  mint: string;
  /** The attendee's wallet. */
  wallet: string;
  blockTime: number | null; // seconds since 1970
  blockHeight: number | null;
}

/**
 * QuickNode signs every delivery: HMAC-SHA256 over nonce + timestamp + body, keyed with the
 * stream's security token, sent as hex in X-QN-Signature. Only QuickNode and we know the token,
 * so a matching signature proves the request really came from our stream.
 */
export function verifyStreamSignature(token: string, nonce: string, timestamp: string, body: string, given: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const expected = createHmac("sha256", Buffer.from(token, "utf8")).update(nonce + timestamp + body, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(given, "hex"));
}

function isAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function isSignature(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 64 || value.length > 90) return false;
  try {
    return bs58.decode(value).length === 64;
  } catch {
    return false;
  }
}

const wholeNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;

/**
 * Pulls claim records out of a delivery. The filter sends `{ claims: [...] }`, and QuickNode
 * may wrap that (e.g. under `data`), so we walk the payload a few levels deep and keep
 * anything shaped like a claim. Every field is checked: this is data from outside.
 */
export interface StreamReceipt { signature: string; hash: string; blockTime: number | null }

export function extractDelivery(payload: unknown) {
  const receipts = new Map<string, StreamReceipt>();
  const found = new Map<string, StreamClaim>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 5000)) visit(item, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    if (isSignature(o.signature) && typeof o.hash === "string" && /^[a-f0-9]{64}$/.test(o.hash)) {
      receipts.set(o.signature, { signature: o.signature, hash: o.hash, blockTime: wholeNumber(o.blockTime) });
      return;
    }
    if (isSignature(o.signature) && isAddress(o.mint) && isAddress(o.owner)) {
      found.set(`${o.signature}:${o.mint}:${o.owner}`, {
        signature: o.signature,
        mint: o.mint,
        wallet: o.owner,
        blockTime: wholeNumber(o.blockTime),
        blockHeight: wholeNumber(o.blockHeight),
      });
      return;
    }
    for (const value of Object.values(o)) visit(value, depth + 1);
  };
  visit(payload, 0);
  return { claims: [...found.values()], receipts: [...receipts.values()] };
}

/**
 * Saves the claims that belong to one of our events (other tokens the organizer wallet might
 * mint are ignored). Safe to receive the same delivery twice: the transaction signature is the
 * primary key, so repeats change nothing.
 */
export async function storeChainClaims(claims: StreamClaim[]): Promise<{ stored: number; ignored: number }> {
  if (claims.length === 0) return { stored: 0, ignored: 0 };
  const ourMints = new Set((await readEvents()).map((e) => e.mint));
  const rows = claims
    .filter((c) => ourMints.has(c.mint))
    .map((c) => ({
      signature: c.signature,
      mint: c.mint,
      wallet: c.wallet,
      block_height: c.blockHeight,
      block_time: c.blockTime ? new Date(c.blockTime * 1000).toISOString() : null,
    }));
  if (rows.length > 0) {
    const { error } = await db().from("chain_claims").upsert(rows, { onConflict: "signature", ignoreDuplicates: true });
    if (error) throw new Error(`chain_claims write failed: ${error.message}`);
  }
  return { stored: rows.length, ignored: claims.length - rows.length };
}

/** Only acknowledge known transactions, even if an unrelated memo uses our text prefix.
 * A signed delivery can also finish an issue whose officer disconnected during confirmation. */
export async function storeReceiptObservations(receipts: StreamReceipt[]) {
  let stored = 0;
  for (const { signature, hash, blockTime } of receipts) {
    const table = db().from("contribution_receipts");
    const read = await table.select("receipt_file, confirmed_at, streamed_at").eq("signature", signature).maybeSingle();
    if (read.error) throw new Error("Could not read receipt observation");
    if (!read.data) continue;
    const file = parseReceiptFile(read.data.receipt_file);
    if (file.receipt.hash !== hash) continue;
    if (!read.data.streamed_at) {
      const time = blockTime ? new Date(blockTime * 1000).toISOString() : new Date().toISOString();
      if (!read.data.confirmed_at) {
        const proof = await verifyDevnetReceipt(file, file.receipt.issuer);
        if (!proof.ok) {
          if (proof.reason === "rpc_error" || proof.reason === "not_found") throw new Error("Receipt confirmation unavailable");
          continue;
        }
        const reconciled = await table.update({ confirmed_at: time, signed_transaction: null })
          .eq("signature", signature).is("confirmed_at", null);
        if (reconciled.error) throw new Error("Could not reconcile receipt confirmation");
      }
      const write = await table.update({ streamed_at: time }).eq("signature", signature)
        .not("confirmed_at", "is", null).is("streamed_at", null);
      if (write.error) throw new Error("Could not save receipt observation");
    }
    stored++;
  }
  return { stored, ignored: receipts.length - stored };
}
