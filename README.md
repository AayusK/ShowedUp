# ShowedUp

Proof of attendance for student clubs, on **Solana devnet**.

**Live:** https://showedup-phi.vercel.app

An organizer creates an event and a rotating QR code appears on the projector. Attendees scan it
with their phone camera, it opens in Phantom, and they tap **Claim**. Each attendee gets one
**soulbound** (non-transferable) token for that event. The organizer's wallet pays every fee, so
attendees never need SOL. A profile page reads a wallet's tokens from the chain and shows a perk
tier: 1 event = Showed Up, 3 = Regular, 5 = Core Member.

Product spec: [SPEC.md](SPEC.md). Notes for Claude Code: [CLAUDE.md](CLAUDE.md).

## Running an event (organizers)

1. On the laptop that drives the projector, open https://showedup-phi.vercel.app/organizer.
2. Click **Create event**, enter the organizer password, fill in name, date, time and (optional)
   location. Creating the event takes a few seconds: it creates the event's token on Solana.
3. Click **Open check-in** on the event. Put that page on the projector: it shows a QR code that
   changes every 30 seconds and a live "N people showed up" count.

Attendees:

1. Scan the QR with the phone's normal camera app. It opens the claim page inside **Phantom**
   (or offers to install Phantom).
2. Tap **Connect wallet** → **Claim attendance** → approve the signature in Phantom. Signing is
   free and sends nothing; it proves they own the wallet.
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
| Attendance = holding a token from an event's mint. Profiles and attendee counts are read from the chain. | Rotating claim code: `HMAC(EVENT_SECRET, eventId:30s-window)`, 6 characters; the current and previous windows are accepted. Claims require the wallet to sign `ShowedUp claim:<eventId>:<code>:<wallet>`. |

The browser never talks to Solana or Supabase directly. Every secret stays on the server.

API: `GET/POST /api/events`, `GET /api/events/[id]/code`, `POST /api/claim`,
`GET /api/profile/[wallet]`, `GET /api/balance/[wallet]`, `POST /api/organizer/verify`.

## Configuration

Six server-only settings, plus one optional public one. In production they're in **Vercel → showedup → Settings → Environment
Variables**; locally they're in `.env.local` (never commit it). See `.env.example`.

| Variable | What it's for |
|---|---|
| `ORGANIZER_SECRET_KEY` | The organizer wallet's secret key (base58 or JSON array). Pays all fees, mints every token. |
| `EVENT_SECRET` | Any long random string. Signs the rotating QR codes. |
| `ORGANIZER_PASSWORD` | Shared password for organizer actions (creating events, showing QR codes). |
| `RPC_URL` | Devnet RPC. Use a free [Helius](https://helius.dev) **devnet** URL; the public endpoint rate-limits. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SECRET_KEY` | Supabase secret key (`sb_secret_…`, Project Settings → API Keys). |
| `PRIVY_APP_ID` (optional) | [Privy](https://dashboard.privy.io) app ID. Lets attendees sign in with email or Google instead of Phantom; a Solana wallet is created for them. Not a secret. Leave empty for Phantom-only. |

None of the six may start with `NEXT_PUBLIC_`: Next.js would copy them into the browser.
After changing a variable in Vercel, redeploy (Deployments → ⋯ → Redeploy) for it to take effect.

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

Create `.env.local` with the six variables above:

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
```

Local development uses the **same database and organizer wallet as production**, so events you
create locally appear on the live site too.

### Deploying

Vercel deploys automatically on every push to `main`. To check a deploy, open the project's
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
