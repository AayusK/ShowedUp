import "server-only";
import { randomBytes } from "crypto";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  MEMO_PROGRAM_ID,
  RECEIPT_FORMAT,
  receiptMemo,
  recordHash,
  type ReceiptFile,
  type RecordFields,
} from "@/lib/receipt";
import { getClubKeypair, type ClubRecord } from "./clubs";
import { OrganizerUnfundedError, getConnection, uniqueSigners, withRetry } from "./mint";
import { getOrganizerKeypair } from "./organizer";

// Two signatures (organizer + club) at 5,000 lamports each, with room to spare. A memo creates
// no account, so there is no rent: a receipt costs about 0.00001 devnet SOL.
const FEE_BUFFER_LAMPORTS = 20_000;

/**
 * The memo instruction for one receipt. Listing the club's address as a signer is what makes
 * the Memo program (v2) refuse to run unless the club's key signed.
 */
export function buildReceiptInstruction(issuer: PublicKey, memo: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: issuer, isSigner: true, isWritable: false }],
    data: Buffer.from(memo, "utf8"),
  });
}

/**
 * Writes the receipt for a confirmed record to Solana devnet and returns the file the student
 * downloads. What goes on-chain is only "showedup:v1:<hash>": no name, no role, no event. The
 * hash is salted with 32 fresh random bytes, so nobody can find out what a record says by
 * guessing likely records and hashing them.
 *
 * The club's key signs the memo (that's the proof of who issued it); the organizer wallet pays
 * the fee, so clubs never need SOL. Nothing is saved in the database here: keeping the record
 * and its salt is up to the caller.
 */
export async function issueReceipt(club: ClubRecord, record: RecordFields): Promise<ReceiptFile> {
  const organizer = getOrganizerKeypair();
  const issuer = getClubKeypair(club);
  const salt = randomBytes(32).toString("hex");
  const hash = recordHash(record, salt);
  const connection = getConnection();

  const balance = await withRetry(() => connection.getBalance(organizer.publicKey));
  if (balance < FEE_BUFFER_LAMPORTS) {
    throw new OrganizerUnfundedError(organizer.publicKey.toBase58(), FEE_BUFFER_LAMPORTS);
  }

  const { blockhash, lastValidBlockHeight } = await withRetry(() => connection.getLatestBlockhash("confirmed"));
  const tx = new Transaction({ feePayer: organizer.publicKey, blockhash, lastValidBlockHeight })
    .add(buildReceiptInstruction(issuer.publicKey, receiptMemo(hash)));
  tx.sign(...uniqueSigners(organizer, issuer));

  // Preflight simulation is on (skipPreflight defaults to false), so a bad tx fails here.
  const signature = await connection.sendRawTransaction(tx.serialize());
  const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (result.value.err) throw new Error("Receipt transaction failed on-chain");

  return {
    format: RECEIPT_FORMAT,
    record,
    salt,
    receipt: { network: "devnet", issuer: issuer.publicKey.toBase58(), hash, signature },
  };
}
