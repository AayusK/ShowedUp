// Give a demo wallet up to four attendance events. New events use private check-ins.
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
  const { newId } = await import("../lib/server/ids");
  const { readEvents, addEvent } = await import("../lib/server/events");
  const { checkIn } = await import("../lib/server/claimsDb");
  const { hasClaimed, mintAttendance } = await import("../lib/server/claim");
  const { getPrivateProfile } = await import("../lib/server/privateProfile");
  const { explorerLink } = await import("../lib/solana");

  let owner: InstanceType<typeof PublicKey>;
  try {
    owner = new PublicKey(wallet);
    if (!PublicKey.isOnCurve(owner.toBytes())) throw new Error();
  } catch {
    console.error(`Not a valid wallet address: ${wallet}`);
    process.exit(1);
  }

  let count = (await getPrivateProfile(owner, { kind: "owner" })).count;
  console.log(`Wallet ${owner.toBase58()} currently has ${count} event(s). Target: ${target}.`);
  if (count >= target) {
    console.log("Nothing to do.");
    return;
  }

  for (const past of PAST_EVENTS) {
    if (count >= target) break;

    // Only the default club's events: the organizer wallet can't mint another club's badge.
    let event = (await readEvents()).find((e) => !e.clubId && e.name === past.name && e.date === past.date);
    if (!event) {
      event = { id: newId(), ...past, mint: null, createdAt: new Date().toISOString() };
      await addEvent(event);
      console.log(`  created event   ${past.name}`);
    }
    if (!event.mint) {
      const result = await checkIn(event.id, owner.toBase58());
      if (result === "success") count++;
      console.log(`  ${result}  ${event.name}`);
      continue;
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

  console.log(`Done. Wallet now has ${(await getPrivateProfile(owner, { kind: "owner" })).count} event(s).`);
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
