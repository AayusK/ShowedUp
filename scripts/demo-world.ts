// Builds a complete demo world for recording the hackathon video: two verified clubs, fake
// members with check-ins, Mentor/Speaker receipts, an opening with applicants, chat groups and a
// few public profiles. Safe to run again: anything that already exists is reused.
//
// Usage:
//   npm run demo:world -- --passcode "<club passcode>" [--student <your wallet>] [--no-receipts]
//
//   --passcode     the passcode for both demo clubs (8+ characters). Only used when a club is
//                  created; an existing club keeps its passcode.
//   --student      your own wallet: it gets 4 past check-ins (one away from Core Member), so
//                  claiming today's event on camera unlocks Core Member.
//   --no-receipts  skip the Mentor/Speaker receipts (they send small devnet transactions).
//
// Needs .env.local with SUPABASE_URL, SUPABASE_SECRET_KEY, ORGANIZER_SECRET_KEY, CLUB_KEY_SECRET,
// RPC_URL, and db/05 … db/08 run in Supabase. Cost: about 0.00001 devnet SOL per receipt.
import { createHash } from "crypto";
import { config } from "dotenv";

config({ path: ".env.local" });

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const CLUB = "UBC Web3 Society";
const OTHER_CLUB = "UBC Hackathon Club";

const MEMBERS = [
  "Priya Sharma", "Marcus Lee", "Jin Wang", "Ana Rodrigues", "Sam Kim", "Leah Cohen", "Omar Haddad",
  "Chloe Martin", "Daniel Park", "Fatima Noor", "Ethan Brooks", "Mei Tanaka", "Lucas Silva", "Zoe Nguyen",
];

/** A date `days` from today at a local wall-clock time, as "YYYY-MM-DDTHH:mm". */
function dayFromToday(days: number, time: string): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${time}`;
}

// Past events oldest first, with how many of the members came (first N of the list), so the
// attendance chart shows growth and the members end up in different tiers.
const PAST = [
  { name: "Fall Kickoff", days: -63, time: "18:00", location: "UBC Nest 2504", came: 8 },
  { name: "Intro to Solana", days: -49, time: "18:00", location: "ICICS X150", came: 9 },
  { name: "Build a dApp in a Night", days: -35, time: "18:30", location: "Innovation Hub", came: 10 },
  { name: "Design & Coffee", days: -21, time: "17:30", location: "The Commons", came: 11 },
  { name: "Hackathon Prep", days: -14, time: "18:00", location: "UBC Nest 2504", came: 12 },
  { name: "Solana Workshop", days: -7, time: "18:00", location: "ICICS X150", came: 14 },
];
const TODAY = { name: "Demo Night", days: 0, time: "18:00", location: "UBC Nest 2504" };
const UPCOMING = { name: "Rust on Solana, part 2", days: 7, time: "18:00", location: "ICICS X150" };

async function main() {
  const args = process.argv.slice(2);
  const passcode = option(args, "--passcode");
  const studentArg = option(args, "--student");
  const receiptsOn = !args.includes("--no-receipts");

  const { Keypair, PublicKey } = await import("@solana/web3.js");
  const { isValidPasscode } = await import("../lib/clubs");
  const { createClub, readClubs, setClubVerified } = await import("../lib/server/clubs");
  const { newId } = await import("../lib/server/ids");
  const { readEvents, addEvent } = await import("../lib/server/events");
  const { checkIn } = await import("../lib/server/claimsDb");
  const { saveMemberName } = await import("../lib/server/members");
  const { createOpening, insertApplication, listClubOpenings } = await import("../lib/server/openings");
  const { db } = await import("../lib/server/db");
  type EventRecord = Awaited<ReturnType<typeof readEvents>>[number];

  let student: string | null = null;
  if (studentArg) {
    try {
      const k = new PublicKey(studentArg);
      if (!PublicKey.isOnCurve(k.toBytes())) throw new Error();
      student = k.toBase58();
    } catch {
      console.error(`Not a valid wallet address: ${studentArg}`);
      process.exit(1);
    }
  }

  // ---- Clubs --------------------------------------------------------------------------------
  async function ensureClub(name: string) {
    const existing = (await readClubs()).find((c) => c.name === name);
    if (existing) {
      if (!existing.verified) await setClubVerified(existing.id, true);
      console.log(`✓ ${name} (existing, id ${existing.id}; keeps its passcode)`);
      return { ...existing, verified: true };
    }
    if (!passcode || !isValidPasscode(passcode)) {
      console.error(`To create "${name}", pass --passcode with 8+ plain characters.`);
      process.exit(1);
    }
    const club = await createClub(name, passcode, true);
    console.log(`✓ ${name} created (id ${club.id}, verified)`);
    return club;
  }
  const club = await ensureClub(CLUB);
  const other = await ensureClub(OTHER_CLUB);

  // ---- Members: fixed fake wallets, so a second run reuses them --------------------------------
  const members = MEMBERS.map((name, i) => {
    const seed = createHash("sha256").update(`showedup-demo-member-${i}`).digest();
    return { name, wallet: Keypair.fromSeed(seed).publicKey.toBase58() };
  });
  for (const m of members) await saveMemberName(m.wallet, m.name);
  console.log(`✓ ${members.length} members with names`);

  // ---- Events and check-ins ---------------------------------------------------------------------
  const existing = await readEvents(club.id);
  async function ensureEvent(e: { name: string; days: number; time: string; location: string }): Promise<EventRecord> {
    const found = existing.find((x) => x.name === e.name && x.kind !== "contribution");
    if (found) return found;
    const record: EventRecord = {
      id: newId(), name: e.name, date: dayFromToday(e.days, e.time), location: e.location,
      mint: null, createdAt: new Date().toISOString(), clubId: club.id,
    };
    await addEvent(record);
    return record;
  }
  const past: EventRecord[] = [];
  let checkins = 0;
  for (const [i, e] of PAST.entries()) {
    const ev = await ensureEvent(e);
    past.push(ev);
    for (const m of members.slice(0, e.came)) if ((await checkIn(ev.id, m.wallet)) === "success") checkins++;
    // Your wallet: the first 4 past events, so today's check-in makes you a Core Member.
    if (student && i < 4 && (await checkIn(ev.id, student)) === "success") checkins++;
  }
  const today = await ensureEvent(TODAY);
  await ensureEvent(UPCOMING);
  // A few people are already "here" today, so the check-in screen isn't empty.
  for (const m of members.slice(0, 5)) if ((await checkIn(today.id, m.wallet)) === "success") checkins++;
  console.log(`✓ ${PAST.length + 2} events, ${checkins} new check-ins`);

  // ---- Receipts (Mentor / Speaker), real devnet transactions -----------------------------------
  if (receiptsOn) {
    const { confirmContribution } = await import("../lib/server/contributions");
    const workshop = past[5];
    const demoNight = past[2];
    const plan = [
      { wallet: members[0].wallet, event: workshop, role: "Mentor" as const, summary: "Mentored first-time builders at the Solana Workshop" },
      { wallet: members[1].wallet, event: demoNight, role: "Speaker" as const, summary: "Gave the opening talk at Build a dApp in a Night" },
      { wallet: members[2].wallet, event: workshop, role: "Volunteer" as const, summary: "Ran the check-in desk" },
      ...(student ? [{ wallet: student, event: workshop, role: "Mentor" as const, summary: "Mentored first-time builders at the Solana Workshop" }] : []),
    ];
    for (const p of plan) {
      const r = await confirmContribution(p.event, club, p.wallet, p.role, p.summary);
      console.log(`  ${p.role.padEnd(9)} ${p.wallet.slice(0, 4)}…  ${r.status}`);
    }
    console.log("✓ receipts");
  }

  // ---- Opening at the second club, with two applicants ------------------------------------------
  const openings = await listClubOpenings(other);
  let opening = openings.find((o) => o.title === "Hackathon mentor");
  if (!opening) {
    const made = await createOpening(other, { title: "Hackathon mentor", description: "Help first-time hackers ship their project over the weekend.", role: "Mentor", minCount: 1, closesAt: null });
    opening = { ...made, applications: 0, pending: 0 };
  }
  await insertApplication(opening.id, members[0].wallet);
  await insertApplication(opening.id, members[3].wallet);
  console.log(`✓ opening "Hackathon mentor" at ${OTHER_CLUB} (id ${opening.id})`);

  // ---- Chat groups and messages (skipped if db/08_chat.sql hasn't been run) ---------------------
  try {
    const { createGroup } = await import("../lib/server/chat");
    const groups = await db().from("chat_groups").select("id, name").eq("club_id", club.id);
    if (groups.error) throw groups.error;
    let vol = (groups.data ?? []).find((g) => g.name === "Hackathon volunteers")?.id as string | undefined;
    if (!vol) {
      vol = await createGroup(club.id, "Hackathon volunteers", "Setup and check-in desk on Saturday", [members[1].wallet, members[2].wallet, members[3].wallet, members[4].wallet, ...(student ? [student] : [])]);
      const msgs = [
        { author_kind: "officer", author_wallet: null, author_name: "Priya, President (officer)", body: "Thanks for signing up! We need 2 people at the check-in desk from 9 to 11." },
        { author_kind: "member", author_wallet: members[1].wallet, author_name: members[1].name, body: "I can do 9 to 10." },
        { author_kind: "member", author_wallet: members[2].wallet, author_name: members[2].name, body: "I'll take 10 to 11." },
        { author_kind: "member", author_wallet: members[2].wallet, author_name: members[2].name, body: "Do we need laptops for check-in?" },
        { author_kind: "officer", author_wallet: null, author_name: "Priya, President (officer)", body: "Just your phone. The QR goes on the projector." },
      ];
      for (const m of msgs) await db().from("chat_messages").insert({ group_id: vol, ...m });
    }
    console.log("✓ chat: Hackathon volunteers");
  } catch {
    console.log("· chat skipped (run db/08_chat.sql to include it)");
  }

  // ---- Public profiles for three members (skipped if db/07_profiles.sql hasn't been run) --------
  try {
    const { saveCard } = await import("../lib/server/profileCards");
    const cards = [
      { i: 0, headline: "CS student · Web3 Society mentor", major: "Computer Science", year: 2027, skills: ["Rust", "TypeScript", "Mentoring"], bio: "I build small Solana tools and help first-time hackers ship their first project." },
      { i: 1, headline: "Design + engineering · speaker", major: "Cognitive Systems", year: 2028, skills: ["Figma", "React", "Public speaking"], bio: "I like turning messy ideas into demos people can click." },
      { i: 2, headline: "Event lead · always at the check-in desk", major: "Commerce", year: 2027, skills: ["Operations", "Python"], bio: "Running events and making sure everyone gets in fast." },
    ];
    for (const c of cards) {
      const m = members[c.i];
      await saveCard(m.wallet, {
        displayName: m.name, headline: c.headline, school: "University of British Columbia", major: c.major, gradYear: c.year,
        bio: c.bio, links: [`https://www.linkedin.com/in/${m.name.toLowerCase().replace(/\s+/g, "-")}-demo`], skills: c.skills, isPublic: true,
      }, new Date().toISOString());
    }
    console.log("✓ 3 public profiles");
  } catch {
    console.log("· profiles skipped (run db/07_profiles.sql to include them)");
  }

  console.log(`
Done. For the recording:
  Club dashboard   sign in to "${CLUB}" with your passcode → Overview, Events, Members, Chat
  Today's event    "${TODAY.name}" → Start check-in → scan with your phone${student ? " (your wallet becomes Core Member)" : ""}
  Second club      "${OTHER_CLUB}" → Openings → "Hackathon mentor" has 2 applicants
  A member's page  /profile/${members[0].wallet}
`);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
  if (msg.includes("enough devnet SOL")) console.error("The organizer wallet is out of devnet SOL. Fund it at https://faucet.solana.com and run again.");
  else if (msg.includes("CLUB_KEY_SECRET")) console.error(`${msg}. Add CLUB_KEY_SECRET to .env.local (the same value as in Vercel).`);
  else console.error(`Demo world failed: ${msg}`);
  process.exit(1);
});
