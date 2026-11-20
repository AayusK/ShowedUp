import "server-only";
import { createPublicKey, verify } from "crypto";
import { PublicKey, Transaction, type Keypair } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAccount,
  getAccountLen,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import { getOrganizerKeypair } from "./organizer";
import { OrganizerUnfundedError, getConnection, uniqueSigners, withRetry } from "./mint";

const FEE_BUFFER_LAMPORTS = 10_000;

/**
 * Proves the person claiming actually controls `wallet`.
 * A Solana address is an Ed25519 public key, so Node's built-in crypto can check the
 * signature directly (the key is passed in JWK form). No extra package needed.
 */
export function verifyWalletSignature(wallet: string, message: string, signatureB58: string): boolean {
  try {
    const pubkey = new PublicKey(wallet).toBytes();
    const signature = bs58.decode(signatureB58);
    if (signature.length !== 64) return false;
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(pubkey).toString("base64url") },
      format: "jwk",
    });
    return verify(null, Buffer.from(message, "utf8"), key, signature);
  } catch {
    return false;
  }
}

/** The attendee's token account for this event (an "associated token account", one per wallet per token). */
function attendeeTokenAccount(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
}

/** True if this wallet already holds at least 1 of the event's token. */
export async function hasClaimed(mint: PublicKey, owner: PublicKey): Promise<boolean> {
  const connection = await getConnection();
  try {
    const account = await withRetry(() =>
      getAccount(connection, attendeeTokenAccount(mint, owner), "confirmed", TOKEN_2022_PROGRAM_ID),
    );
    return account.amount >= BigInt(1);
  } catch (e) {
    if (e instanceof TokenAccountNotFoundError || e instanceof TokenInvalidAccountOwnerError) return false;
    throw e;
  }
}

/**
 * Gives the attendee 1 token of this event's badge, in one transaction:
 *  1. create the attendee's token account for this event if it doesn't exist yet
 *  2. mint exactly 1 token into it
 * The organizer wallet pays the fee and the rent. The club that issued the badge (`issuer`) is
 * the only one allowed to mint it, so its key signs too. Without `issuer`, the organizer wallet
 * is the issuer (the default club).
 * Because the mint is NonTransferable, the attendee can never send this token to anyone.
 */
export async function mintAttendance(mint: PublicKey, owner: PublicKey, issuer?: Keypair): Promise<string> {
  const organizer = getOrganizerKeypair();
  const club = issuer ?? organizer;
  const connection = await getConnection();
  const ata = attendeeTokenAccount(mint, owner);

  // Worst case we create a new token account: NonTransferable mints give it the
  // NonTransferableAccount + ImmutableOwner extensions, so size the rent for that.
  const rent = await withRetry(() =>
    connection.getMinimumBalanceForRentExemption(
      getAccountLen([ExtensionType.NonTransferableAccount, ExtensionType.ImmutableOwner]),
    ),
  );
  const balance = await withRetry(() => connection.getBalance(organizer.publicKey));
  if (balance < rent + FEE_BUFFER_LAMPORTS) {
    throw new OrganizerUnfundedError(organizer.publicKey.toBase58(), rent + FEE_BUFFER_LAMPORTS);
  }

  const { blockhash, lastValidBlockHeight } = await withRetry(() =>
    connection.getLatestBlockhash("confirmed"),
  );
  const tx = new Transaction({ feePayer: organizer.publicKey, blockhash, lastValidBlockHeight }).add(
    createAssociatedTokenAccountIdempotentInstruction(
      organizer.publicKey, // payer
      ata,
      owner,
      mint,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createMintToInstruction(mint, ata, club.publicKey, 1, [], TOKEN_2022_PROGRAM_ID), // the club is the mint authority
  );
  tx.sign(...uniqueSigners(organizer, club));

  const signature = await connection.sendRawTransaction(tx.serialize());
  const result = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (result.value.err) throw new Error("Claim transaction failed on-chain");
  return signature;
}
