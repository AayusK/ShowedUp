// Demo: a look-alike badge from a wallet that isn't a club, to show the profile won't count it.
//
// Usage:  npm run fake-badge -- <wallet address> [--club "<club name>"]
//
// A brand-new random wallet "issues" a Mentor badge that copies a real contribution badge
// exactly: same symbol, same fields, same Token-2022 extensions, and it can even name a real
// club. The organizer wallet only pays the fees. Nothing is written to the database. Because the
// badge's address isn't derived from any registered club's wallet, the profile page lists it
// under "Unverified issuer · not counted".
// Cost (organizer pays): about 0.004 SOL (the token's rent + the wallet's token account rent).
import {
  PACKET_DATA_SIZE,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAccountLen,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  badgeMintAddress,
  buildEventMintInstructions,
  eventMintSizes,
  eventTokenMetadata,
  withRetry,
  type EventMintDetails,
} from "../lib/server/mint";

const FEE_BUFFER_LAMPORTS = 10_000;

/** Today in local time, as the "YYYY-MM-DDTHH:mm" a real badge stores (the profile rejects other formats). */
export function todayBadgeDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T18:00`;
}

export interface FakeBadgePlan {
  tx: VersionedTransaction;
  mint: PublicKey;
  ata: PublicKey;
  /** Lamports the payer needs: the token's rent, the token account's rent and a fee buffer. */
  neededLamports: number;
  blockhash: string;
  lastValidBlockHeight: number;
}

/**
 * Builds the one transaction (unsigned) that creates the look-alike badge and gives 1 to `owner`:
 *  1-7. the same instructions a real badge uses (buildEventMintInstructions), with `issuer` as
 *       mint authority, permanent delegate and metadata update authority
 *  8.   create the owner's Token-2022 token account for it (does nothing if it already exists)
 *  9.   mint exactly 1 into it, `issuer` signing as mint authority
 * `payer` pays every fee and all rent. Signers needed: payer and issuer.
 */
export async function buildFakeBadgeTransaction(
  connection: Connection,
  payer: PublicKey,
  issuer: PublicKey,
  owner: PublicKey,
  details: EventMintDetails,
): Promise<FakeBadgePlan> {
  const mint = await badgeMintAddress(issuer, details.id);
  const metadata = eventTokenMetadata(mint, issuer, details);
  const { mintSpace, metadataSpace } = eventMintSizes(metadata);
  const [mintRent, ataRent] = await Promise.all([
    withRetry(() => connection.getMinimumBalanceForRentExemption(mintSpace + metadataSpace)),
    withRetry(() =>
      connection.getMinimumBalanceForRentExemption(
        getAccountLen([ExtensionType.NonTransferableAccount, ExtensionType.ImmutableOwner]),
      ),
    ),
  ]);
  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);

  const { blockhash, lastValidBlockHeight } = await withRetry(() => connection.getLatestBlockhash("confirmed"));
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [
      ...buildEventMintInstructions(payer, issuer, mint, details.id, metadata, mintRent),
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        ata,
        owner,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createMintToInstruction(mint, ata, issuer, 1, [], TOKEN_2022_PROGRAM_ID),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  if (tx.serialize().length > PACKET_DATA_SIZE) {
    throw new Error("The badge details are too long to fit in one Solana transaction; use a shorter --club name.");
  }

  return { tx, mint, ata, neededLamports: mintRent + ataRent + FEE_BUFFER_LAMPORTS, blockhash, lastValidBlockHeight };
}

const USAGE = 'Usage: npm run fake-badge -- <wallet address> [--club "<club name>"]';

async function main() {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });

  // Accept --club=Name as well as --club Name; anything else starting with -- is a mistake.
  const args = process.argv.slice(2).flatMap((a) => (a.startsWith("--club=") ? ["--club", a.slice(7)] : [a]));
  const unknown = args.find((a) => a.startsWith("--") && a !== "--club");
  if (unknown) {
    console.error(`Unknown option ${unknown}\n${USAGE}`);
    process.exit(1);
  }
  const clubIdx = args.indexOf("--club");
  const clubArg = clubIdx >= 0 ? args[clubIdx + 1] : undefined;
  if (clubIdx >= 0 && (!clubArg || clubArg.startsWith("--"))) {
    console.error(USAGE);
    process.exit(1);
  }
  const wallet = args.find((a, i) => !a.startsWith("--") && (clubIdx < 0 || i !== clubIdx + 1));
  if (!wallet) {
    console.error(USAGE);
    process.exit(1);
  }
  let owner: PublicKey;
  try {
    owner = new PublicKey(wallet);
    if (!PublicKey.isOnCurve(owner.toBytes())) throw new Error();
  } catch {
    console.error(`Not a valid wallet address: ${wallet}\n${USAGE}`);
    process.exit(1);
  }

  // Imported after dotenv so the server libs see RPC_URL and the Supabase settings.
  const { Keypair } = await import("@solana/web3.js");
  const { getConnection } = await import("../lib/server/mint");
  const { getOrganizerKeypair } = await import("../lib/server/organizer");
  const { db } = await import("../lib/server/db");
  const { newId } = await import("../lib/server/ids");
  const { LEGACY_CLUB_ID, LEGACY_CLUB_NAME, cleanClubName } = await import("../lib/clubs");
  const { explorerLink } = await import("../lib/solana");

  // The club the fake badge names. Default: the first verified club other than the default one.
  // Read-only query (readClubs() would also insert the default club's row if it were missing).
  let club = clubArg ? cleanClubName(clubArg) : "";
  if (clubArg && !club) {
    console.error(`Not a usable club name: ${clubArg}`);
    process.exit(1);
  }
  // The profile only repeats a club's name when it matches a registered club, and it hides
  // unverified badges entirely if it can't read the clubs list. So both must hold for the demo.
  let registered: { id: string; name: string; verified: boolean }[];
  try {
    const { data, error } = await db().from("clubs").select("id, name, verified").order("created_at", { ascending: true });
    if (error) throw error;
    registered = data as { id: string; name: string; verified: boolean }[];
  } catch {
    console.error("Couldn't read the clubs list from Supabase. The track record page needs it to list the fake badge, so nothing was created.");
    process.exit(1);
  }
  if (club) {
    const match = registered.find((c) => c.name.toLowerCase() === club.toLowerCase());
    if (!match) {
      console.error(`No registered club is called "${club}". Use a real club's name so the profile shows "It names ${club}, but…".`);
      process.exit(1);
    }
    club = match.name;
  } else {
    club = registered.find((c) => c.verified && c.id !== LEGACY_CLUB_ID)?.name ?? LEGACY_CLUB_NAME;
  }

  let organizer: InstanceType<typeof Keypair>;
  try {
    organizer = getOrganizerKeypair();
  } catch {
    console.error("ORGANIZER_SECRET_KEY in .env.local is missing or not a valid secret key. The organizer wallet pays the fees.");
    process.exit(1);
  }

  // The fake issuer: a fresh wallet nobody registered as a club. Its key is thrown away after.
  const fakeIssuer = Keypair.generate();
  const details: EventMintDetails = {
    id: newId(),
    name: "Hackathon Mentor",
    date: todayBadgeDate(),
    location: "Innovation Hub",
    kind: "contribution",
    role: "Mentor",
    club,
  };

  const connection = getConnection();
  const plan = await buildFakeBadgeTransaction(connection, organizer.publicKey, fakeIssuer.publicKey, owner, details);

  const balance = await withRetry(() => connection.getBalance(organizer.publicKey));
  if (balance < plan.neededLamports) {
    console.error(
      `The organizer wallet ${organizer.publicKey.toBase58()} doesn't have enough devnet SOL ` +
        `(needs about ${(plan.neededLamports / 1e9).toFixed(4)} SOL). Fund it at https://faucet.solana.com and try again.`,
    );
    process.exit(1);
  }

  plan.tx.sign([organizer, fakeIssuer]);
  const signature = await connection.sendTransaction(plan.tx);
  const result = await connection.confirmTransaction(
    { signature, blockhash: plan.blockhash, lastValidBlockHeight: plan.lastValidBlockHeight },
    "confirmed",
  );
  if (result.value.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(result.value.err)}`);

  console.log(`Fake Mentor badge naming "${club}" given to ${owner.toBase58()}`);
  console.log(`  mint         ${plan.mint.toBase58()}`);
  console.log(`  fake issuer  ${fakeIssuer.publicKey.toBase58()}`);
  console.log(`  token        ${explorerLink(plan.mint.toBase58())}`);
  console.log(`  transaction  ${explorerLink(signature, "tx")}`);
  console.log(`Open /profile/${owner.toBase58()}: it should show under 'Unverified issuer · not counted'.`);
}

// Run only as a script, not when another file imports buildFakeBadgeTransaction.
if (/fake-badge\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
