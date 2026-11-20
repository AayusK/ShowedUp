// Contribution receipts. When a club confirms what someone did, the record itself stays private
// (in our database and in the student's downloaded copy). Only a salted hash of it goes on
// Solana, in a memo that the club's own key signs. This file holds everything needed to check
// such a receipt: it reads nothing from ShowedUp's database and needs no secrets, only the
// downloaded file, a Solana RPC, and the club address you already trust.
//
// Node only (uses node:crypto). Used by the server and by scripts/verify-receipt.ts.
import { createHash, createPublicKey, verify } from "crypto";
import { PublicKey, type Connection } from "@solana/web3.js";
import bs58 from "bs58";

/** The `format` value of a downloaded record file. */
export const RECEIPT_FORMAT = "showedup-record/v1";

/**
 * Solana's Memo program (version 2). A memo is a short text attached to a transaction. Version 2
 * refuses to run unless every account listed in the memo instruction signed the transaction, so
 * listing the club's address makes the memo a statement signed by the club.
 */
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const MEMO_PREFIX = "showedup:v1:";
const HASH_LABEL = "showedup-record:v1";
const SALT_RE = /^[0-9a-f]{64}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

/** What a record may contain: plain JSON with whole numbers only, so every language hashes it the same way. */
export type RecordValue = string | number | boolean | null | RecordValue[] | { [key: string]: RecordValue };
export type RecordFields = { [key: string]: RecordValue };

/** The file a student downloads and can hand to another club. */
export interface ReceiptFile {
  format: typeof RECEIPT_FORMAT;
  /** The confirmed record, exactly as the club approved it. */
  record: RecordFields;
  /** 32 random bytes (hex). Without it, nobody can guess a record from the hash on Solana. */
  salt: string;
  receipt: {
    network: "devnet";
    /** The issuing club's Solana address. Only trust it if it matches the address the club publishes. */
    issuer: string;
    /** recordHash(record, salt), as written in the memo. */
    hash: string;
    /** The Solana transaction that holds the memo. */
    signature: string;
  };
}

export class ReceiptFormatError extends Error {}

/**
 * The record as one exact string: keys sorted, no spaces. Sorting matters because
 * `{"a":1,"b":2}` and `{"b":2,"a":1}` are the same record but different text. For the values we
 * allow (strings, whole numbers, true/false/null, lists, objects) this is the same output as
 * RFC 8785 (JSON Canonicalization Scheme), so a verifier in another language can use a JCS library.
 */
export function canonicalJson(value: RecordValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new ReceiptFormatError("Numbers in a record must be whole numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => {
      if (value[k] === undefined) throw new ReceiptFormatError(`Record field "${k}" has no value`);
      return `${JSON.stringify(k)}:${canonicalJson(value[k])}`;
    }).join(",")}}`;
  }
  throw new ReceiptFormatError("A record may only contain text, whole numbers, true/false, null, lists and objects");
}

/**
 * The salted hash that goes on Solana: SHA-256 of "showedup-record:v1:<salt>:<canonical record>",
 * as 64 hex characters. Change one letter of the record (or the salt) and the hash is different.
 */
export function recordHash(record: RecordFields, salt: string): string {
  if (!SALT_RE.test(salt)) throw new ReceiptFormatError("The salt must be 64 hex characters");
  return createHash("sha256").update(`${HASH_LABEL}:${salt}:${canonicalJson(record)}`, "utf8").digest("hex");
}

/** The memo text written on Solana for a record: "showedup:v1:<hash>". */
export function receiptMemo(hash: string): string {
  return `${MEMO_PREFIX}${hash}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isAddress(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 32 || v.length > 44) return false;
  try {
    return new PublicKey(v).toBase58() === v;
  } catch {
    return false;
  }
}

/** Checks that a parsed JSON file has the shape of a record file. Throws ReceiptFormatError if not. */
export function parseReceiptFile(raw: unknown): ReceiptFile {
  if (!isPlainObject(raw) || raw.format !== RECEIPT_FORMAT) {
    throw new ReceiptFormatError(`Not a ShowedUp record file (expected format "${RECEIPT_FORMAT}")`);
  }
  const { record, salt, receipt } = raw;
  if (!isPlainObject(record)) throw new ReceiptFormatError("The file has no record");
  if (typeof salt !== "string" || !SALT_RE.test(salt)) throw new ReceiptFormatError("The salt must be 64 hex characters");
  if (!isPlainObject(receipt)) throw new ReceiptFormatError("The file has no receipt");
  if (receipt.network !== "devnet") throw new ReceiptFormatError('Only "devnet" receipts exist so far');
  if (!isAddress(receipt.issuer)) throw new ReceiptFormatError("The issuer is not a Solana address");
  if (typeof receipt.hash !== "string" || !HASH_RE.test(receipt.hash)) throw new ReceiptFormatError("The hash must be 64 hex characters");
  if (typeof receipt.signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(receipt.signature)) {
    throw new ReceiptFormatError("The transaction signature is not valid");
  }
  // Throws if the record holds something we can't hash the same way everywhere.
  canonicalJson(record as RecordFields);
  return {
    format: RECEIPT_FORMAT,
    record: record as RecordFields,
    salt,
    receipt: { network: "devnet", issuer: receipt.issuer, hash: receipt.hash, signature: receipt.signature },
  };
}

export type VerifyFailure =
  /** The record or salt doesn't match what the club signed: it was changed after the club confirmed it. */
  | "edited"
  /** No such transaction on Solana devnet. */
  | "not_found"
  /** The transaction exists but failed, so nothing was recorded. */
  | "failed_tx"
  /** The transaction has no ShowedUp receipt memo. */
  | "no_memo"
  /** The expected club address did not sign the receipt memo. */
  | "not_signed_by_issuer"
  /** Couldn't reach Solana; try again. */
  | "rpc_error";

export type VerifyResult =
  | {
      ok: true;
      /** The club address that signed (the one you passed in, or else the one the file names). */
      issuer: string;
      hash: string;
      signature: string;
      slot: number;
      /** When Solana recorded the receipt (seconds since 1970), if the node reports it. */
      blockTime: number | null;
    }
  | { ok: false; reason: VerifyFailure };

function ed25519Verify(signer: PublicKey, message: Uint8Array, signatureB58: string): boolean {
  try {
    const signature = bs58.decode(signatureB58);
    if (signature.length !== 64) return false;
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(signer.toBytes()).toString("base64url") },
      format: "jwk",
    });
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}

/**
 * Checks a record file against Solana, and nothing else:
 *  1. hash the record with its salt
 *  2. fetch the transaction named in the file
 *  3. it succeeded, and the club's address is one of its signers
 *  4. the club's Ed25519 signature on the transaction checks out (we check it ourselves, rather
 *     than taking the RPC node's word for it)
 *  5. it holds a Memo v2 instruction that lists the club's address and says "showedup:v1:<hash>"
 * Pass `trustedIssuer` (the address the club publishes) to check against that instead of the
 * address the file names. Without it, a valid answer only means "signed by the address in the
 * file", and you still have to know whose address that is.
 */
export async function verifyReceipt(file: ReceiptFile, connection: Connection, trustedIssuer?: string): Promise<VerifyResult> {
  const hash = recordHash(file.record, file.salt);
  if (hash !== file.receipt.hash) return { ok: false, reason: "edited" };
  if (trustedIssuer && trustedIssuer !== file.receipt.issuer) return { ok: false, reason: "not_signed_by_issuer" };
  const issuer = new PublicKey(trustedIssuer ?? file.receipt.issuer);

  let tx;
  try {
    tx = await connection.getTransaction(file.receipt.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  } catch {
    return { ok: false, reason: "rpc_error" };
  }
  if (!tx) return { ok: false, reason: "not_found" };
  if (!tx.meta || tx.meta.err) return { ok: false, reason: "failed_tx" };

  const message = tx.transaction.message;
  const keys = message.staticAccountKeys;
  // Signers always come first in a transaction's account list.
  const signerCount = message.header.numRequiredSignatures;
  const issuerIndex = keys.findIndex((k) => k.equals(issuer));
  const issuerSigned = issuerIndex >= 0 && issuerIndex < signerCount
    && ed25519Verify(issuer, message.serialize(), tx.transaction.signatures[issuerIndex]);

  // Every ShowedUp memo in the transaction, and whether it lists the club's address.
  const memos: { text: string; byIssuer: boolean }[] = [];
  for (const ix of message.compiledInstructions) {
    if (!keys[ix.programIdIndex]?.equals(MEMO_PROGRAM_ID)) continue;
    const text = Buffer.from(ix.data).toString("utf8");
    if (!text.startsWith(MEMO_PREFIX)) continue;
    memos.push({ text, byIssuer: issuerIndex >= 0 && ix.accountKeyIndexes.includes(issuerIndex) });
  }

  if (memos.length === 0) return { ok: false, reason: "no_memo" };
  const signedMemos = issuerSigned ? memos.filter((m) => m.byIssuer) : [];
  if (signedMemos.length === 0) return { ok: false, reason: "not_signed_by_issuer" };
  if (!signedMemos.some((m) => m.text === receiptMemo(hash))) return { ok: false, reason: "edited" };

  return {
    ok: true,
    issuer: issuer.toBase58(),
    hash,
    signature: file.receipt.signature,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
  };
}
