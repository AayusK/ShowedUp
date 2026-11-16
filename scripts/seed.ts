// Demo prep: give a wallet attendance at past events so the live demo can show it
// going from 4 to 5 and unlocking Core Member.
//
// Usage:  npm run seed -- <wallet address> [--target 4]
//
// For each of 4 past events (created on first run, reused afterwards) it mints 1
// attendance token to the wallet, stopping once the wallet holds `target` events
// in total (default 4). Safe to run again: it never mints twice to the same wallet
// and never creates duplicate past events.
// Cost (organizer pays): about 0.003 SOL per new event + 0.002 SOL per new token account.
import { config } from "dotenv";

config({ path: ".env.local" });

const PAST_EVENTS = [
  { name: "Fall Kickoff", date: "2026-10-07T18:00", location: "UBC Nest" },
  { name: "Welcome Social", date: "2026-10-14T18:30", location: "The Commons" },
  { name: "Ship Night", date: "2026-10-21T19:00", location: "Innovation Hub" },
  { name: "Design & Coffee", date: "2026-10-28T17:30", location: "The Commons" },
];

async function main() {
  const args = process.argv.slice(2);
  const wallet = args.find((a) => !a.startsWith("--"));
  const targetIdx = args.indexOf("--target");
  const target = targetIdx >= 0 ? Number(args[targetIdx + 1]) : 4;
  if (!wallet || !Number.isInteger(target) || target < 1 || target > PAST_EVENTS.length) {
    console.error("Usage: npm run seed -- <wallet address> [--target 1-4]");
    process.exit(1);
  }

  // Imported after dotenv so the server libs see RPC_URL and the Supabase settings.
  const { PublicKey } = await import("@solana/web3.js");
  const { randomBytes } = await import("crypto");
  const { readEvents, addEvent } = await import("../lib/server/events");
  const { createEventMint } = await import("../lib/server/mint");
  const { hasClaimed, mintAttendance } = await import("../lib/server/claim");
  const { getProfile } = await import("../lib/server/profile");
  const { explorerLink } = await import("../lib/solana");

  let owner: InstanceType<typeof PublicKey>;
  try {
    owner = new PublicKey(wallet);
    if (!PublicKey.isOnCurve(owner.toBytes())) throw new Error();
  } catch {
    console.error(`Not a valid wallet address: ${wallet}`);
    process.exit(1);
  }

  let count = (await getProfile(owner)).count;
  console.log(`Wallet ${owner.toBase58()} currently has ${count} event(s). Target: ${target}.`);
  if (count >= target) {
    console.log("Nothing to do.");
    return;
  }

  const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
  const newId = () => Array.from(randomBytes(8), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");

  for (const past of PAST_EVENTS) {
    if (count >= target) break;

    let event = (await readEvents()).find((e) => e.name === past.name && e.date === past.date);
    if (!event) {
      const { mint } = await createEventMint(past);
      event = { id: newId(), ...past, mint, createdAt: new Date().toISOString() };
      await addEvent(event);
      console.log(`  created event   ${past.name}  (${explorerLink(mint)})`);
    }

    const mint = new PublicKey(event.mint);
    if (await hasClaimed(mint, owner)) {
      console.log(`  already holds   ${past.name}`);
      continue;
    }
    const sig = await mintAttendance(mint, owner);
    count++;
    console.log(`  minted          ${past.name}  (${explorerLink(sig, "tx")})`);
  }

  console.log(`Done. Wallet now has ${(await getProfile(owner)).count} event(s).`);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
  if (msg.includes("enough devnet SOL")) {
    console.error("The organizer wallet is out of devnet SOL. Fund it at https://faucet.solana.com and run again.");
  } else {
    console.error(`Seed failed: ${msg}`);
  }
  process.exit(1);
});
