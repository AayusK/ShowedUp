import "server-only";
import {
  Connection,
  Keypair,
  PACKET_DATA_SIZE,
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
  createInitializePermanentDelegateInstruction,
  getMintLen,
} from "@solana/spl-token";
import {
  createInitializeInstruction,
  createUpdateFieldInstruction,
  pack,
  type TokenMetadata,
} from "@solana/spl-token-metadata";
import { PUBLIC_DEVNET_RPC } from "@/lib/solana";
import type { BadgeKind, Role } from "@/lib/badges";
import { getOrganizerKeypair } from "./organizer";

// Rough per-transaction fee buffer on top of the mint account's rent.
const FEE_BUFFER_LAMPORTS = 10_000;

export class OrganizerUnfundedError extends Error {
  constructor(public organizer: string, public neededLamports: number) {
    super("Organizer wallet does not have enough devnet SOL");
  }
}

/** The badge's details don't fit in one Solana transaction (about 1,200 bytes in total). */
export class BadgeTooLargeError extends Error {
  constructor() {
    super("Badge details are too long to store on Solana");
  }
}

// The genesis block identifies the cluster even when the RPC URL has a custom hostname.
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const publicDevnet = new Connection(PUBLIC_DEVNET_RPC, "confirmed");
let checkedRpc: { url: string; until: number; connection: Promise<Connection> } | undefined;

async function selectDevnet(url: string): Promise<Connection> {
  try {
    const response = await fetch(url, {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4500),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] }),
    });
    if (response.ok && (await response.json()).result === DEVNET_GENESIS) return new Connection(url, "confirmed");
  } catch {
    // A misconfigured or unreachable custom RPC must never receive a signed transaction.
  }
  console.warn("[solana] Custom RPC could not confirm Solana devnet. Using the public devnet endpoint.");
  return publicDevnet;
}

/** Resolve one confirmed devnet connection for reads and writes, including concurrent cold starts. */
export async function getConnection(): Promise<Connection> {
  const url = process.env.RPC_URL?.trim();
  if (!url || url === PUBLIC_DEVNET_RPC) return publicDevnet;
  if (!checkedRpc || checkedRpc.url !== url || Date.now() >= checkedRpc.until) {
    checkedRpc = { url, until: Date.now() + 60_000, connection: selectDevnet(url) };
  }
  return checkedRpc.connection;
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

/** Two roles can be the same wallet (the default club's issuer is the organizer): sign once. */
export function uniqueSigners(...signers: Keypair[]): Keypair[] {
  const seen = new Set<string>();
  return signers.filter((s) => {
    const key = s.publicKey.toBase58();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What gets written into the event's token, readable by anyone straight from the chain. */
export interface EventMintDetails {
  /** The event's id (8 characters). Also the seed the token's address is derived from. */
  id: string;
  name: string;
  /** Local wall-clock time "YYYY-MM-DDTHH:mm", as the organizer entered it. */
  date: string;
  location?: string;
  /** "attendance" (claimed with the QR code) or "contribution" (awarded by an officer). */
  kind: BadgeKind;
  /** What the badge says the holder did: Attendee, Volunteer, Speaker, Mentor, Organizer or Officer. */
  role: Role;
  /** The issuing club's name. Club names on-chain are fine; a student's name never goes here. */
  club: string;
}

/** Ticker shown next to the event name in wallets and explorers. */
export const BADGE_SYMBOL = "SHOWEDUP";

/**
 * The address of a badge's token ("mint"), worked out from the issuing club's wallet and the
 * badge id. Solana only lets an account be created at such an address if that wallet signs, so
 * the address itself proves who issued the badge. Anyone can repeat this calculation; nobody
 * can fake it. (Checking only the "mint authority" isn't enough: whoever creates a token can
 * hand that title to any address afterwards without its consent.)
 */
export function badgeMintAddress(issuer: PublicKey, id: string): Promise<PublicKey> {
  return PublicKey.createWithSeed(issuer, id, TOKEN_2022_PROGRAM_ID);
}

/**
 * The metadata stored inside the mint account: the badge's name plus `date`, `location`, `id`,
 * `kind`, `role` and `club` fields. Nothing here identifies the student who receives it.
 */
export function eventTokenMetadata(mint: PublicKey, authority: PublicKey, details: EventMintDetails): TokenMetadata {
  const additionalMetadata: [string, string][] = [["date", details.date]];
  if (details.location) additionalMetadata.push(["location", details.location]);
  additionalMetadata.push(["id", details.id], ["kind", details.kind], ["role", details.role], ["club", details.club]);
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
    mintSpace: getMintLen([ExtensionType.NonTransferable, ExtensionType.MetadataPointer, ExtensionType.PermanentDelegate]),
    metadataSpace: TYPE_SIZE + LENGTH_SIZE + pack(metadata).length,
  };
}

/**
 * The instructions that create one event's token. `payer` pays, `issuer` is the club's wallet
 * (the authority over the token), `mint` must be badgeMintAddress(issuer, seed).
 * `lamports` must cover rent for the mint account *including* its metadata (see eventMintSizes):
 * the token program grows the account when the metadata is written, but doesn't add the rent itself.
 */
export function buildEventMintInstructions(
  payer: PublicKey,
  issuer: PublicKey,
  mint: PublicKey,
  seed: string,
  metadata: TokenMetadata,
  lamports: number,
): TransactionInstruction[] {
  const { mintSpace } = eventMintSizes(metadata);
  return [
    // 1. Allocate the mint account, owned by the Token-2022 program, at the address derived
    //    from the club's wallet. The System Program requires the club's signature for this.
    SystemProgram.createAccountWithSeed({
      fromPubkey: payer,
      newAccountPubkey: mint,
      basePubkey: issuer,
      seed,
      lamports,
      space: mintSpace,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // 2. Say where the metadata lives: inside the mint account itself. Extensions must be set
    //    before the mint is initialized.
    createInitializeMetadataPointerInstruction(mint, issuer, mint, TOKEN_2022_PROGRAM_ID),
    // 3. Turn on NonTransferable (tokens can't be sent on = "soulbound").
    createInitializeNonTransferableMintInstruction(mint, TOKEN_2022_PROGRAM_ID),
    // 4. Make the club the "permanent delegate": the one address allowed to burn (take back)
    //    a badge it handed out by mistake. Nobody else can, and it can never be changed.
    createInitializePermanentDelegateInstruction(mint, issuer, TOKEN_2022_PROGRAM_ID),
    // 5. Initialize the mint: 0 decimals, the club = mint authority, no freeze authority.
    createInitializeMintInstruction(mint, 0, issuer, null, TOKEN_2022_PROGRAM_ID),
    // 6. Write the event name and symbol into the mint.
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: issuer,
      mint,
      mintAuthority: issuer,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
    }),
    // 7. Add the extra fields (date, location, id, kind, role, club).
    ...metadata.additionalMetadata.map(([field, value]) =>
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint,
        updateAuthority: issuer,
        field,
        value,
      }),
    ),
  ];
}

/**
 * Creates a new Token-2022 mint for one event, issued by a club:
 *  - its address is derived from the club's wallet, which proves the club created it
 *  - NonTransferable extension (tokens can't be sent on = "soulbound")
 *  - Permanent Delegate extension: the club can burn a badge it issued by mistake
 *  - Metadata extension: the badge's name, date, location, kind, role and club are stored in
 *    the mint itself, so anyone can read what a badge is for without asking our database
 *  - 0 decimals (you either attended or you didn't)
 *  - the club is the mint authority; no freeze authority
 * The organizer wallet pays the rent for the new mint account and the fee, so clubs never need
 * SOL. The club's key signs only because it is the authority. Without `issuer`, the organizer
 * wallet is the issuer (the default club).
 */
export async function createEventMint(details: EventMintDetails, issuer?: Keypair): Promise<{ mint: string; signature: string }> {
  const organizer = getOrganizerKeypair();
  const club = issuer ?? organizer;
  const connection = await getConnection();
  const mint = await badgeMintAddress(club.publicKey, details.id);

  const metadata = eventTokenMetadata(mint, club.publicKey, details);
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
    ...buildEventMintInstructions(organizer.publicKey, club.publicKey, mint, details.id, metadata, rent),
  );
  tx.sign(...uniqueSigners(organizer, club));

  // A transaction can't be larger than one network packet. Long names (or names with emoji,
  // which take several bytes per character) can push it over: say so instead of failing oddly.
  let raw: Buffer;
  try {
    raw = tx.serialize();
  } catch {
    throw new BadgeTooLargeError();
  }
  if (raw.length > PACKET_DATA_SIZE) throw new BadgeTooLargeError();

  // Preflight simulation is on (skipPreflight defaults to false), so a bad tx fails here.
  const signature = await connection.sendRawTransaction(raw);
  const result = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (result.value.err) throw new Error("Mint transaction failed on-chain");

  return { mint: mint.toBase58(), signature };
}
