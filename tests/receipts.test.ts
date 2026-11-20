import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { badgesTowardRule } from "../lib/openings";
import { privateReadMessage } from "../lib/privateAccess";
import type { ProfileEvent } from "../lib/profileClient";
import { MEMO_PROGRAM_ID, RECEIPT_FORMAT, receiptMemo, recordHash, verifyReceipt, type ReceiptFile } from "../lib/receipt";
import { authorizePrivateRead } from "../lib/server/privateAccess";
import { readPages } from "../lib/server/db";
import { sendReceipt } from "../lib/server/receipts";
import { extractDelivery } from "../lib/server/streamClaims";

const payer = "Bn38cCVx4BHdZ6Zcx5rqJinMncYcGyqhJeJe3gfvpfce";
const signature = bs58.encode(Buffer.alloc(64, 7));
const salt = "1a".repeat(32);
const record = { summary: "Mentored at a workshop" };
const hash = recordHash(record, salt);
const file: ReceiptFile = {
  format: RECEIPT_FORMAT, record, salt, receipt: { network: "devnet", issuer: payer, hash, signature },
};

test("verification detects a changed summary and a different trusted club before querying devnet", async (t) => {
  const rpc = new Connection("http://localhost:8899");
  const lookup = t.mock.method(rpc, "getTransaction", () => { throw new Error("unexpected lookup"); });
  assert.deepEqual(await verifyReceipt({ ...file, record: { summary: "Changed" } }, rpc), { ok: false, reason: "edited" });
  assert.deepEqual(await verifyReceipt(file, rpc, Keypair.generate().publicKey.toBase58()), { ok: false, reason: "not_signed_by_issuer" });
  assert.equal(lookup.mock.callCount(), 0);
});

test("a send timeout after acceptance is reconciled using the saved signature", async (t) => {
  t.mock.method(Connection.prototype, "sendRawTransaction", async () => { throw new Error("connection timed out"); });
  const lookup = t.mock.method(Connection.prototype, "getSignatureStatuses", async (signatures: string[]) => {
    assert.deepEqual(signatures, [signature]);
    return { value: [{ confirmationStatus: "confirmed", err: null }] };
  });
  assert.equal(await sendReceipt({ receipt_file: file, signed_transaction: "AA==", last_valid_block_height: 123 }), true);
  assert.equal(lookup.mock.callCount(), 1);
});

test("a private read checks the public origin, target wallet, scope and expiry behind a proxy", async () => {
  const signer = Keypair.generate();
  const wallet = signer.publicKey.toBase58();
  const jwk = { kty: "OKP", crv: "Ed25519", x: Buffer.from(signer.publicKey.toBytes()).toString("base64url"),
    d: Buffer.from(signer.secretKey.slice(0, 32)).toString("base64url") };
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  const origin = "https://showedup.example";
  function request(at = Date.now(), site = origin) {
    const message = privateReadMessage(origin, "profile", wallet, at);
    return new Request("http://localhost:3000/api/profile", { method: "POST",
      headers: { host: "showedup.example", "x-forwarded-proto": "https", origin: site },
      body: JSON.stringify({ wallet, issuedAt: at, signature: bs58.encode(sign(null, Buffer.from(message), key)) }) });
  }
  assert.equal((await authorizePrivateRead(request(), "profile", wallet))?.toBase58(), wallet);
  assert.equal(await authorizePrivateRead(request(), "opening/abcd1234", wallet), null);
  assert.equal(await authorizePrivateRead(request(), "profile", payer), null);
  assert.equal(await authorizePrivateRead(request(Date.now() - 360_000), "profile", wallet), null);
  assert.equal(await authorizePrivateRead(request(Date.now(), "https://other.example"), "profile", wallet), null);
});

test("the stream recognizes raw and parsed devnet memos and deduplicates their public fields", () => {
  const script = readFileSync("streams/claims-filter.js", "utf8");
  const program = MEMO_PROGRAM_ID.toBase58();
  const instructions = [
    { programIdIndex: 1, data: bs58.encode(Buffer.from(receiptMemo(hash))) },
    { programId: program, parsed: receiptMemo(hash) },
  ];
  const transactions = instructions.map(ix => ({ meta: { err: null }, transaction: { signatures: [signature],
    message: { accountKeys: [payer, program], instructions: [ix] } } }));
  const stream = { data: [{ blockTime: 123, transactions }] };
  const delivery = runInNewContext(script + "\nmain(stream)", { stream });
  assert.deepEqual(extractDelivery(delivery), { claims: [], receipts: [{ signature, hash, blockTime: 123 }] });
});

test("opening rules count verified receipts and legacy badges and exclude private attendance", () => {
  const club = { id: "showedup", name: "Builders", issuer: payer, verified: true };
  const receipt: ProfileEvent = { club, source: "receipt", id: "event-Mentor", name: "Workshop", date: "2026-11-01",
    mint: null, kind: "contribution", role: "Mentor" };
  const attendance: ProfileEvent = { ...receipt, id: "event", source: "checkin", kind: "attendance", role: "Attendee" };
  const legacy: ProfileEvent = { ...attendance, source: "chain", mint: payer };
  const unverified = { ...receipt, club: { ...club, verified: false } };
  assert.deepEqual(badgesTowardRule([receipt, attendance, legacy, unverified], null), [receipt, legacy]);
  assert.deepEqual(badgesTowardRule([receipt, attendance, legacy, unverified], "Mentor"), [receipt]);
});

test("wallet history and rosters can read past the first thousand database rows", async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => index);
  const result = await readPages(async (first, last) => ({ data: rows.slice(first, last + 1), error: null }));
  assert.deepEqual(result, { data: rows, error: null });
});
