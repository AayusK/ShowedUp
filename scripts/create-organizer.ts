// Generates the organizer keypair (pays all fees + mint authority for every event,
// so attendees claim gaslessly), prints the .env.local line, and requests a devnet airdrop.
// Usage: npx tsx scripts/create-organizer.ts
// If ORGANIZER_SECRET_KEY is already set in .env.local, it reuses that key and just tops it up.
import { config } from "dotenv";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";

config({ path: ".env.local" });

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";

function loadOrCreate(): { kp: Keypair; isNew: boolean } {
  const raw = process.env.ORGANIZER_SECRET_KEY?.trim();
  if (!raw) return { kp: Keypair.generate(), isNew: true };
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw);
  return { kp: Keypair.fromSecretKey(bytes), isNew: false };
}

async function main() {
  const { kp, isNew } = loadOrCreate();
  const address = kp.publicKey.toBase58();

  if (isNew) {
    console.log("New organizer keypair. Add this line to .env.local (keep it secret):\n");
    console.log(`ORGANIZER_SECRET_KEY=${bs58.encode(kp.secretKey)}\n`);
  } else {
    console.log("Using existing ORGANIZER_SECRET_KEY from .env.local");
  }
  console.log(`Organizer address: ${address}`);

  const conn = new Connection(RPC, "confirmed");
  try {
    const sig = await conn.requestAirdrop(kp.publicKey, 1 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
    console.log("Airdropped 1 devnet SOL.");
  } catch (e) {
    console.log(`Airdrop failed (${(e as Error).message.split("\n")[0]}).`);
    console.log(`Fund this address at https://faucet.solana.com : ${address}`);
  }

  const bal = await conn.getBalance(kp.publicKey);
  console.log(`Balance: ${bal / LAMPORTS_PER_SOL} SOL (devnet)`);
}

main();
