import "server-only";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createInitializeNonTransferableMintInstruction,
  getMintLen,
} from "@solana/spl-token";
import {
  createInitializeInstruction,
  createUpdateFieldInstruction,
  pack,
  type TokenMetadata,
} from "@solana/spl-token-metadata";
import { PUBLIC_DEVNET_RPC } from "@/lib/solana";
import { getOrganizerKeypair } from "./organizer";

// Rough per-transaction fee buffer on top of the mint account's rent.
const FEE_BUFFER_LAMPORTS = 10_000;

export class OrganizerUnfundedError extends Error {
  constructor(public organizer: string, public neededLamports: number) {
    super("Organizer wallet does not have enough devnet SOL");
  }
}

export function getConnection(): Connection {
  // RPC_URL (e.g. a Helius devnet URL with its API key) is server-only and never sent to browsers.
  return new Connection(process.env.RPC_URL || PUBLIC_DEVNET_RPC, "confirmed");
}

/** Retry once after a short pause; the public devnet RPC rate-limits. */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 750));
    return fn();
  }
}

/** What gets written into the event's token, readable by anyone straight from the chain. */
export interface EventMintDetails {
  name: string;
  /** Local wall-clock time "YYYY-MM-DDTHH:mm", as the organizer entered it. */
  date: string;
  location?: string;
}

/** Ticker shown next to the event name in wallets and explorers. */
export const BADGE_SYMBOL = "SHOWEDUP";

/** The metadata stored inside the mint account: event name plus `date` / `location` fields. */
export function eventTokenMetadata(mint: PublicKey, authority: PublicKey, details: EventMintDetails): TokenMetadata {
  const additionalMetadata: [string, string][] = [["date", details.date]];
  if (details.location) additionalMetadata.push(["location", details.location]);
  return {
    updateAuthority: authority,
    mint,
    name: details.name,
    symbol: BADGE_SYMBOL,
    uri: "",
    additionalMetadata,
  };
}

/** Mint account size before metadata, and the extra bytes the metadata will take once written. */
export function eventMintSizes(metadata: TokenMetadata): { mintSpace: number; metadataSpace: number } {
  return {
    mintSpace: getMintLen([ExtensionType.NonTransferable, ExtensionType.MetadataPointer]),
    metadataSpace: TYPE_SIZE + LENGTH_SIZE + pack(metadata).length,
  };
}

/**
 * The instructions that create one event's token. `lamports` must cover rent for the mint
 * account *including* its metadata (see eventMintSizes): the token program grows the account
 * when the metadata is written, but doesn't add the rent itself.
 */
export function buildEventMintInstructions(
  payer: PublicKey,
  mint: PublicKey,
  metadata: TokenMetadata,
  lamports: number,
): TransactionInstruction[] {
  const { mintSpace } = eventMintSizes(metadata);
  return [
    // 1. Allocate the mint account, owned by the Token-2022 program.
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: mint,
      space: mintSpace,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // 2. Say where the metadata lives: inside the mint account itself. Extensions must be set
    //    before the mint is initialized.
    createInitializeMetadataPointerInstruction(mint, payer, mint, TOKEN_2022_PROGRAM_ID),
    // 3. Turn on NonTransferable (tokens can't be sent on = "soulbound").
    createInitializeNonTransferableMintInstruction(mint, TOKEN_2022_PROGRAM_ID),
    // 4. Initialize the mint: 0 decimals, organizer = mint authority, no freeze authority.
    createInitializeMintInstruction(mint, 0, payer, null, TOKEN_2022_PROGRAM_ID),
    // 5. Write the event name and symbol into the mint.
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: payer,
      mint,
      mintAuthority: payer,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
    }),
    // 6. Add the extra fields (date, location).
    ...metadata.additionalMetadata.map(([field, value]) =>
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint,
        updateAuthority: payer,
        field,
        value,
      }),
    ),
  ];
}

/**
 * Creates a new Token-2022 mint for one event:
 *  - NonTransferable extension (tokens can't be sent on = "soulbound")
 *  - Metadata extension: the event's name, date and location are stored in the mint itself,
 *    so anyone can read what a badge is for without asking our database
 *  - 0 decimals (you either attended or you didn't)
 *  - organizer is the mint authority; no freeze authority
 * The organizer pays the rent for the new mint account and the fee.
 */
export async function createEventMint(details: EventMintDetails): Promise<{ mint: string; signature: string }> {
  const organizer = getOrganizerKeypair();
  const connection = getConnection();
  const mint = Keypair.generate();

  const metadata = eventTokenMetadata(mint.publicKey, organizer.publicKey, details);
  const { mintSpace, metadataSpace } = eventMintSizes(metadata);
  const rent = await withRetry(() => connection.getMinimumBalanceForRentExemption(mintSpace + metadataSpace));

  const balance = await withRetry(() => connection.getBalance(organizer.publicKey));
  if (balance < rent + FEE_BUFFER_LAMPORTS) {
    throw new OrganizerUnfundedError(organizer.publicKey.toBase58(), rent + FEE_BUFFER_LAMPORTS);
  }

  const { blockhash, lastValidBlockHeight } = await withRetry(() =>
    connection.getLatestBlockhash("confirmed"),
  );

  const tx = new Transaction({ feePayer: organizer.publicKey, blockhash, lastValidBlockHeight }).add(
    ...buildEventMintInstructions(organizer.publicKey, mint.publicKey, metadata, rent),
  );
  tx.sign(organizer, mint);

  // Preflight simulation is on (skipPreflight defaults to false), so a bad tx fails here.
  const signature = await connection.sendRawTransaction(tx.serialize());
  const result = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (result.value.err) throw new Error("Mint transaction failed on-chain");

  return { mint: mint.publicKey.toBase58(), signature };
}
