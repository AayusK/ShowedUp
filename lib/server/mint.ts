import "server-only";
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeNonTransferableMintInstruction,
  getMintLen,
} from "@solana/spl-token";
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

/**
 * Creates a new Token-2022 mint for one event:
 *  - NonTransferable extension (tokens can't be sent on = "soulbound")
 *  - 0 decimals (you either attended or you didn't)
 *  - organizer is the mint authority; no freeze authority
 * The organizer pays the rent for the new mint account and the fee.
 */
export async function createEventMint(): Promise<{ mint: string; signature: string }> {
  const organizer = getOrganizerKeypair();
  const connection = getConnection();
  const mint = Keypair.generate();

  const space = getMintLen([ExtensionType.NonTransferable]);
  const rent = await withRetry(() => connection.getMinimumBalanceForRentExemption(space));

  const balance = await withRetry(() => connection.getBalance(organizer.publicKey));
  if (balance < rent + FEE_BUFFER_LAMPORTS) {
    throw new OrganizerUnfundedError(organizer.publicKey.toBase58(), rent + FEE_BUFFER_LAMPORTS);
  }

  const { blockhash, lastValidBlockHeight } = await withRetry(() =>
    connection.getLatestBlockhash("confirmed"),
  );

  const tx = new Transaction({ feePayer: organizer.publicKey, blockhash, lastValidBlockHeight }).add(
    // 1. Allocate the mint account, owned by the Token-2022 program.
    SystemProgram.createAccount({
      fromPubkey: organizer.publicKey,
      newAccountPubkey: mint.publicKey,
      space,
      lamports: rent,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // 2. Turn on NonTransferable. Extensions must be set before the mint is initialized.
    createInitializeNonTransferableMintInstruction(mint.publicKey, TOKEN_2022_PROGRAM_ID),
    // 3. Initialize the mint: 0 decimals, organizer = mint authority, no freeze authority.
    createInitializeMintInstruction(mint.publicKey, 0, organizer.publicKey, null, TOKEN_2022_PROGRAM_ID),
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
