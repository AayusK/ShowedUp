import "server-only";
import { randomBytes } from "crypto";
import bs58 from "bs58";
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

export interface PreparedReceipt {
  receipt_file: ReceiptFile;
  signed_transaction: string;
  last_valid_block_height: number;
}

/** Sign first so an officer's request can persist the exact transaction before broadcasting. */
export async function prepareReceipt(
  club: ClubRecord, record: RecordFields, salt = randomBytes(32).toString("hex"),
): Promise<PreparedReceipt> {
  const organizer = getOrganizerKeypair();
  const issuer = getClubKeypair(club);
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

  return {
    receipt_file: {
      format: RECEIPT_FORMAT, record, salt,
      receipt: { network: "devnet", issuer: issuer.publicKey.toBase58(), hash, signature: bs58.encode(tx.signature!) },
    },
    signed_transaction: tx.serialize().toString("base64"),
    last_valid_block_height: lastValidBlockHeight,
  };
}

/** Re-sending these same bytes always has the same transaction signature. */
export async function sendReceipt(prepared: PreparedReceipt): Promise<boolean> {
  const connection = getConnection();
  const signature = prepared.receipt_file.receipt.signature;
  const bytes = Buffer.from(prepared.signed_transaction, "base64");
  // The RPC can report a duplicate submission or time out after accepting the bytes. Only
  // the status of this specific signature decides whether the approval actually landed.
  try {
    await connection.sendRawTransaction(bytes);
  } catch {
    // A retry can safely broadcast the persisted bytes again if no status appears.
  }
  const deadline = Date.now() + 10_000;
  do {
    const { value: [status] } = await connection.getSignatureStatuses([signature]);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      if (status.err) throw new Error("Receipt transaction failed on-chain");
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 700));
  } while (Date.now() < deadline);
  return false;
}

/** Standalone demo. The app uses the durable attempt in contributions.ts. */
export async function issueReceipt(club: ClubRecord, record: RecordFields): Promise<ReceiptFile> {
  const prepared = await prepareReceipt(club, record);
  if (!await sendReceipt(prepared)) {
    const blockhash = Transaction.from(Buffer.from(prepared.signed_transaction, "base64")).recentBlockhash!;
    const result = await getConnection().confirmTransaction({ signature: prepared.receipt_file.receipt.signature,
      blockhash, lastValidBlockHeight: prepared.last_valid_block_height }, "confirmed");
    if (result.value.err) throw new Error("Receipt transaction failed on-chain");
  }
  return prepared.receipt_file;
}
