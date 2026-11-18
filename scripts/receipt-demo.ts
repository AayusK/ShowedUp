// Writes one sample contribution receipt to Solana devnet and saves the file a student would
// download. Used to test the Solana side of contribution records before the app has screens for it.
//
// Usage:  npm run receipt:demo -- [--club <club id>] [--name "Maya Chen"] [--wallet <address>] [--out demo.receipt.json]
//
// Without --club it issues as the default club (its key is the organizer wallet). With --club it
// uses that club's own key, which needs CLUB_KEY_SECRET in .env.local. Without --wallet the
// record names a made-up wallet address.
// Cost (organizer pays): about 0.00001 SOL. Nothing is written to the database.
import { writeFileSync } from "fs";
import { config } from "dotenv";

config({ path: ".env.local" });

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const clubId = option(args, "--club");
  const name = option(args, "--name") ?? "Maya Chen";
  const out = option(args, "--out") ?? "demo.receipt.json";

  // Imported after dotenv so the server libs see the settings.
  const { Keypair, PublicKey } = await import("@solana/web3.js");
  const { getClub, legacyClub } = await import("../lib/server/clubs");
  const { issueReceipt } = await import("../lib/server/receipts");
  const { explorerLink } = await import("../lib/solana");

  let wallet: string;
  try {
    const key = new PublicKey(option(args, "--wallet") ?? Keypair.generate().publicKey);
    if (!PublicKey.isOnCurve(key.toBytes())) throw new Error();
    wallet = key.toBase58();
  } catch {
    console.error(`Not a valid wallet address: ${option(args, "--wallet")}`);
    process.exit(1);
  }

  const club = clubId ? await getClub(clubId) : legacyClub();
  if (!club) {
    console.error(`No club with id "${clubId}".`);
    process.exit(1);
  }

  // A sample of what "Confirm contributions" will produce. Only its salted hash goes on Solana.
  // The wallet ties the record to one person: a club receiving it can check that the applicant
  // signs with that same wallet, so a copied file is no use to anyone else.
  const record = {
    kind: "contribution",
    club: { id: club.id, name: club.name, issuer: club.issuer },
    person: { name, wallet },
    role: "Mentor",
    summary: "Mentored at 3 workshops",
    term: "Fall 2026",
    events: [
      { name: "Intro to Solana", date: "2026-09-24" },
      { name: "Build a dApp in a Night", date: "2026-10-15" },
      { name: "Hackathon Prep", date: "2026-11-05" },
    ],
    confirmedAt: new Date().toISOString(),
  };

  console.log(`Issuing a receipt as ${club.name} (${club.issuer})…`);
  const file = await issueReceipt(club, record);
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);

  console.log(`  memo on Solana   showedup:v1:${file.receipt.hash}`);
  console.log(`  transaction      ${explorerLink(file.receipt.signature, "tx")}`);
  console.log(`  saved            ${out}`);
  console.log("");
  console.log("Check it (no database, no secrets):");
  console.log(`  npm run receipt:verify -- ${out} --issuer ${club.issuer}`);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
  if (msg.includes("enough devnet SOL")) {
    console.error("The organizer wallet is out of devnet SOL. Fund it at https://faucet.solana.com and run again.");
  } else if (msg.includes("CLUB_KEY_SECRET")) {
    console.error(`${msg}. Only the default club can issue without it (leave out --club).`);
  } else {
    console.error(`Receipt failed: ${msg}`);
  }
  process.exit(1);
});
