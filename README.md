# ShowedUp

Proof of attendance for student clubs, on **Solana devnet**.

**Live:** https://showedup-phi.vercel.app

An organizer creates an event and a rotating QR code appears on the projector. Attendees scan it
with their phone camera, it opens in Phantom, and they tap **Claim**. Each attendee gets one
**soulbound** (non-transferable) token for that event. The organizer's wallet pays every fee, so
attendees never need SOL. A profile page reads a wallet's tokens from the chain and shows a perk
tier: 1 event = Showed Up, 3 = Regular, 5 = Core Member.

Product spec: [SPEC.md](SPEC.md). Notes for Claude Code: [CLAUDE.md](CLAUDE.md).

**Now a track record across clubs.** Each club issues badges from its own Solana wallet: attendance
by QR code, and role badges (Mentor, Speaker, Volunteer…) awarded by an officer. A student's
track record groups them by club and term; a second club can post an opening with a rule and
pick people from records it can check on Solana. Records are positive only, and no student's
name is ever written on-chain.

## Before merging to `main` or deploying (one-time)

The track-record code needs these on the **live** setup first, or the new pages fail:

1. In the live Supabase project's SQL editor, run in order: `db/01_clubs.sql`,
   `db/02_role_badges.sql`, `db/03_openings.sql`, `db/04_revocation.sql` (each is safe to run
   twice and never drops anything). Also `streams/chain_claims.sql` if it isn't there yet.
2. In Vercel → Settings → Environment Variables, set `CLUB_KEY_SECRET` (see Configuration). Set it
   once and never change it.
3. Redeploy.

## Running an event (organizers)

1. On the laptop that drives the projector, open https://showedup-phi.vercel.app/organizer.
2. Click **Create event**, enter the organizer password, fill in name, date, time and (optional)
   location. Creating the event takes a few seconds: it creates the event's token on Solana.
3. Click **Open check-in** on the event. Put that page on the projector: it shows a QR code that
   changes every 30 seconds and a live "N people showed up" count. Click **Present on a
   projector** for a full-screen version with a much larger QR code (Esc to leave).

Attendees:

1. Scan the QR with the phone's normal camera app.
   - With sign-in on (`PRIVY_APP_ID` set): the claim page opens in the phone's browser. Tap
     **Sign in to claim**, use email or Google, then **Claim attendance**. No app to install; a
     Solana wallet is created for them behind the scenes. Phantom users can tap **Open in Phantom**.
   - Without it: the claim page opens inside **Phantom** (or offers to install Phantom).
2. Phantom users: tap **Connect wallet** → **Claim attendance** → approve the signature in
   Phantom. Signing is free and sends nothing; it proves they own the wallet.
3. They see "You showed up." with a link to the transaction. **My attendance** shows their events
   and tier. Anyone can check a wallet at **My attendance → Verify a wallet**.

Tokens live on devnet, so they only appear inside Phantom when it's set to devnet
(Settings → Developer Settings → Testnet Mode → Solana Devnet). Claiming and the profile page
work either way.

## How it works

| On-chain (Solana devnet) | Server (Next.js on Vercel) + database (Supabase) |
|---|---|
| One Token-2022 mint per event: 0 decimals, **NonTransferable** extension, organizer is mint authority. New events also use the **Metadata** extension: the event name, `date` and `location` are stored in the mint itself. | `events` table: `id, name, starts_at, location, mint` |
| A claim creates the attendee's token account (if needed) and mints 1 token. The organizer pays. | `claims` table: one row per (event, wallet). Its primary key is the lock that stops double claims across server instances. |
| Attendance = holding a token from an event's mint. Profiles and attendee counts are read from the chain: a profile lists every token the wallet holds that the organizer wallet issued, using the name and date stored in the token. The database is only needed for older events without those details. | Rotating claim code: `HMAC(EVENT_SECRET, eventId:30s-window)`, 6 characters; the current and previous windows are accepted. Claims require the wallet to sign `ShowedUp claim:<eventId>:<code>:<wallet>`. |

The browser never talks to Solana or Supabase directly. Every secret stays on the server.

API: `GET/POST /api/clubs` (admin), `GET/POST /api/events`, `GET /api/events/[id]/code`,
`GET /api/events/[id]/attendees`, `POST /api/events/[id]/award`, `POST /api/events/[id]/revoke`,
`POST /api/claim`, `GET /api/profile/[wallet]`, `GET/POST /api/openings`, `/api/openings/[id]/{check,apply,applications}`,
`GET /api/feed`, `GET /api/balance/[wallet]`, `POST /api/organizer/verify`.

### Taking back a badge

Officers see a **Revoke** button on the check-in "Who's here" list and on a role badge's
recipients page. It burns the student's token: every badge made since clubs existed names its
club as the token's *permanent delegate* (an address Solana lets remove that token from any
holder). The organizer pays the fee and `claims.revoked_at` records it. Badges from before clubs
existed can't be taken back, so the button doesn't show for them.

### Live across clubs

The home page shows the newest badges from every verified club, as the QuickNode Stream saw them
on Solana: role, club, event, a shortened wallet and the time, never a name. It refreshes every
15 seconds and shows a quiet "resting" line when the stream is off.

## Configuration

Seven server-only settings, plus one optional public one. In production they're in **Vercel → showedup → Settings → Environment
Variables**; locally they're in `.env.local` (never commit it). See `.env.example`.

| Variable | What it's for |
|---|---|
| `ORGANIZER_SECRET_KEY` | The organizer wallet's secret key (base58 or JSON array). Pays all fees, mints every token. |
| `EVENT_SECRET` | Any long random string. Signs the rotating QR codes. |
| `ORGANIZER_PASSWORD` | Password of the registry admin, who creates and verifies clubs. Also the default club's passcode (creating events, showing QR codes). |
| `CLUB_KEY_SECRET` | Any long random string (32+ characters). Every other club's Solana wallet is worked out from it and the club's id, so no club key is stored anywhere. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Never change it once clubs exist:** every club would get a new wallet and the badges they already issued would stop counting. |
| `RPC_URL` | Devnet RPC. Use a free [Helius](https://helius.dev) **devnet** URL; the public endpoint rate-limits. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SECRET_KEY` | Supabase secret key (`sb_secret_…`, Project Settings → API Keys). |
| `PRIVY_APP_ID` (optional) | [Privy](https://dashboard.privy.io) app ID. Lets attendees sign in with email or Google instead of Phantom; a Solana wallet is created for them. Not a secret. Leave empty for Phantom-only. |

| `QUICKNODE_STREAM_TOKEN` (optional) | Security token of the QuickNode Stream that sends claims to `/api/streams/claims`. A secret. See "Live claim feed" below. |

None of the secrets may start with `NEXT_PUBLIC_`: Next.js would copy them into the browser.
After changing a variable in Vercel, redeploy (Deployments → ⋯ → Redeploy) for it to take effect.

### Live claim feed (QuickNode Streams)

A [QuickNode Stream](https://www.quicknode.com/streams) watches every new Solana devnet block
and tells ShowedUp the moment the organizer wallet hands someone an attendance token. The app
stores those claims in the `chain_claims` table, so it learns about attendance from the chain
as it happens instead of asking Solana over and over.

One-time setup:

1. **Table:** in the Supabase SQL editor, run [`streams/chain_claims.sql`](streams/chain_claims.sql).
2. **Stream:** in QuickNode, create a Stream with network **Solana Devnet**, dataset **Block**,
   starting at the latest block. In the filter editor, paste
   [`streams/claims-filter.js`](streams/claims-filter.js) and set `ORGANIZER` at the top to the
   organizer wallet address.
3. **Destination:** choose **Webhook** with the URL `https://<your site>/api/streams/claims`.
   Copy the stream's **security token**.
4. **Token:** set `QUICKNODE_STREAM_TOKEN` to that token in Vercel (and `.env.local`), then
   redeploy.

What you see: on the check-in page, the "Who's here" list includes everyone the stream has
reported, plus anyone only the app has recorded so far, and a line under it says how many were
seen live on Solana. Tokens handed out outside the web app (for example by `npm run seed`) show
up too. If the stream is paused, the list keeps working from the app's own record.

How it stays safe: QuickNode signs every delivery with the token (HMAC-SHA256), and the endpoint
rejects anything unsigned. It only stores claims for tokens that belong to one of our events,
and receiving the same delivery twice changes nothing.

QuickNode charges credits for every block the stream reads, whether or not it contains a claim.
On a free plan, pause the stream when you're not running an event or a demo.

### Keeping the organizer wallet funded

Every new event costs about 0.003 devnet SOL and every new attendee about 0.002, paid by the
organizer wallet. When it runs low the app says "The organizer wallet needs devnet SOL". Fund the
organizer address at https://faucet.solana.com (select **Devnet**). 1 SOL covers hundreds of
attendees.

## Local development

Requires Node 20+ (developed on Node 24, Windows 11).

```bash
npm install --ignore-scripts
```

`--ignore-scripts` is required on Windows: a dependency of `@solana/wallet-adapter-wallets` runs a
Unix-only install script.

Create `.env.local` with the seven variables above:

```powershell
Copy-Item .env.example .env.local
```

For a brand-new organizer wallet, run `npm run organizer`, paste the printed
`ORGANIZER_SECRET_KEY=…` line into `.env.local`, and fund the printed address at the faucet.

```bash
npm run dev                         # http://localhost:3000
npm run build                       # production build (what Vercel runs)
npx tsc --noEmit                    # typecheck
npx eslint app components lib scripts
npm run seed -- <wallet address>    # give a wallet 4 past events (safe to re-run; --target N)
npm run fake-badge -- <wallet> [--club "Club name"]   # demo: a look-alike Mentor badge from a random wallet
```

`fake-badge` shows what a forged badge looks like: a random wallet creates a badge with the right
symbol and a real club's name, and the organizer pays the fee. Nothing is written to the
database. The wallet's track record then lists it under "Unverified issuer · not counted".

Local development uses the **same database and organizer wallet as production**, so events you
create locally appear on the live site too.

### Deploying

Vercel deploys automatically on every push to `main` of the repo the Vercel project is linked
to. The project is on Ojas's account (`ojas-deshmukhs-projects`); check which repo it's linked to
before relying on this. To check a deploy, open the project's
**Deployments** tab on vercel.com.

### Testing on a phone without deploying

Phantom needs an HTTPS link, so for testing local changes on a phone, run a Cloudflare quick
tunnel next to `npm run dev`:

```bash
cloudflared tunnel --url http://localhost:3000
```

Open the printed `https://….trycloudflare.com` link (not `localhost`) on the laptop so the QR
points at it. Quick-tunnel links change on every restart and can drop at any time; they're for
testing only. Install once with `winget install --id Cloudflare.cloudflared`.

## Limits and known trade-offs

- **Devnet only.** Tokens have no real value, and Solana could reset devnet.
- **Codes can be shared for up to about 60 seconds.** A screenshot of the QR works until two
  30-second windows pass. Good enough for a club meeting; a stricter version could shorten the
  window or check location.
- **One shared organizer password** for the club, kept in the browser's session storage after
  it's entered.
- The perks shown on the profile page are sample copy for now.
- `data/events.json` is no longer used (events live in Supabase); it's kept as a backup of the
  first events.
