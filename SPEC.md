# ShowedUp — Spec

**Practice hackathon (UBC 2026 prep) · Track: Consumer Apps · Chain: Solana devnet · Started as a demo (Nov 4); now in real use by one club, live at https://showedup-phi.vercel.app**

## Problem
Student clubs track attendance in spreadsheets. They're easy to fake, and they disappear when officers graduate. Students have no portable proof that they were active members, which matters for leadership roles, references and sponsor perks.

## User
- **Attendee:** a student at a club meeting with a phone and Phantom. They don't need SOL and don't need to understand crypto.
- **Organizer:** a club officer with a laptop and projector who wants a one-click way to take attendance.

## Core feature
The organizer creates an event and a rotating QR code appears. Attendees scan it, connect Phantom and tap **Claim**. Each attendee receives one **soulbound attendance token** for that event. A profile page reads their attendance history from the chain and shows a perk tier: 1 = Showed Up, 3 = Regular, 5 = Core Member.

## Why blockchain
- **Portable and permanent:** attendance lives in the student's wallet, not a club spreadsheet. Any org or sponsor can verify it without asking us.
- **Can't be faked or traded:** Token-2022 **NonTransferable** extension (soulbound).
- **Gasless for users:** the organizer key pays all fees and does all minting.

## On-chain vs off-chain
| On-chain (Solana devnet) | Off-chain (Next.js server) |
|---|---|
| One Token-2022 mint per event: decimals 0, NonTransferable, organizer is mint authority | Event list `{id, name, starts_at, location, mint}` in Supabase (`events` table); per-(event, wallet) claim lock + log in `claims` |
| Each claim: create the attendee's ATA if needed, then mint 1 token. The organizer pays. | Rotating claim code: `HMAC(EVENT_SECRET, eventId + floor(now/30s))`, 6 chars. The current and previous windows are accepted. |
| Attendance = token balance > 0 for that event's mint (the source of truth for profiles) | Organizer page gated by the `ORGANIZER_PASSWORD` env var. The organizer key comes from `ORGANIZER_SECRET_KEY`. |

API: `POST/GET /api/events`, `GET /api/events/[id]/code`, `POST /api/claim`, `GET /api/profile/[wallet]`.

## Demo script (90 s)
1. Organizer: `/organizer` → **Create event** "Builders Meeting — Nov 4" → big QR appears.
2. Attendee (Phantom in-app browser): scan → **Connect wallet** → **Claim**.
3. Success screen shows a check mark, "You showed up to …" and a Solana Explorer (devnet) tx link.
4. `/profile/<wallet>`: a pre-seeded wallet with 4 past meetings moves to 5 and **Core Member** unlocks live.
5. Claiming again shows "Already claimed". An expired code shows "Code expired, scan again."

## Parts
0. Setup: Next.js + TS + Tailwind, Solana deps, `.gitignore`/`.env.example`, `scripts/create-organizer.ts`, git
1. Wallet connect (devnet provider, header button, address + SOL balance)
2. Create event (organizer page, NonTransferable mint, event list with Explorer links)
3. Rotating QR (`/organizer/[id]`, big QR, code text, 30 s countdown)
4. Claim (`/claim/[eventId]`, mint 1, success and error states, mobile-first)
5. Profile + perks (`/profile/[wallet]`, tiers, progress to the next tier)
6. Demo prep (seed script, home page, README, deployment)
Stretch: mint metadata, live claimers list, Verify page.

## Decisions made (where the prompt left a choice)
- **Next.js 15 App Router** via `create-next-app`, with Tailwind v4 (the current default).
- **Webpack, not Turbopack:** Windows Application Control on our dev laptop blocks Next's native SWC binary. Next falls back to WASM, which Turbopack doesn't support, so `dev`/`build` drop `--turbopack`.
- **Scripts run with `tsx`** (`npx tsx scripts/…`). It's simpler than ts-node with ESM.
- **Secret key format:** `create-organizer.ts` prints a base58 key. The server accepts either base58 or a JSON array.
- **RPC:** server-only `RPC_URL` (a free Helius devnet URL); falls back to `https://api.devnet.solana.com`. The browser never calls Solana directly.
- **Event IDs:** short random slugs (8 chars). They're used in URLs and the HMAC input.
- **Organizer auth:** the password is sent as an `x-organizer-password` header on create-event. The code endpoint also requires it, so attendees can't fetch codes themselves.
- **Deployment (final):** Vercel + Supabase (CryptoClub org). Started on the organizer laptop + a Cloudflare tunnel for the Nov 4 demo, then moved to hosting for real use. Claims also require a Phantom `signMessage` to prove wallet ownership, and the QR opens the claim page inside Phantom.
