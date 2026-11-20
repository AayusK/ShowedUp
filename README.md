# ShowedUp

Student clubs use ShowedUp to check people in privately and give students verifiable records of their contributions. A club signs each contribution on Solana devnet. A student can download the record and share it with another club.

[Live app](https://showed-up.vercel.app) · [Product spec](SPEC.md)

## Deployment setup

1. Apply `db/01_clubs.sql`, `db/02_role_badges.sql`, `db/03_openings.sql`, `db/04_revocation.sql`, and `db/05_private_checkins.sql` in order in the target Supabase project. The last migration allows private events and creates the receipts table. Each migration can be run again.
2. Apply `streams/chain_claims.sql` for legacy stream deliveries.
3. Configure the server variables below in Vercel. Existing clubs need their original `CLUB_KEY_SECRET` and issuer addresses.
4. Deploy the app. For the live feed, install the filter described under **Live claim feed**.

## Running an event

1. Open **Organizer**, sign in to the club, select **Create event**, and enter its name and date.
2. Open the event’s check-in screen. Attendees scan the rotating QR, sign in with email, Google or Phantom, and confirm their attendance. The first check-in asks for a name. Each wallet gets one entry on the event’s private roster.
3. Choose **Confirm a contribution** on the event, or **Award contribution** on the organizer page. Select the event, role and checked-in attendees, describe their work, and confirm. Each student gets one receipt per event and role. A retry uses the saved approval.
4. Students open **My track record → View my private check-ins and receipts**, approve the wallet message, and choose **Contributions → Download receipt**. They can share that JSON file with anyone they choose. The public profile link shows legacy token badges.
5. For an opening, students sign to check eligibility. Applying shares matching contributions with the receiving club’s officers. Private check-ins count toward the student’s attendance tier.

### Verifying a receipt

From this checkout, use the downloaded file and an issuer address obtained from the club. The verifier reads Solana devnet directly.

```bash
npm run receipt:verify -- student.receipt.json --issuer <trusted-club-address>
```

A matching receipt prints `VALID`. Editing a field in the downloaded record after issuance produces `EDITED`. To issue a standalone test file using the local organizer wallet, run `npm run receipt:demo`.

## How records are stored

| Action | Supabase | Solana devnet |
|---|---|---|
| Create an event or check in | Event with an empty mint address and one confirmed row per event and wallet | No transaction |
| Confirm a contribution | Approved record, salt and signed transaction saved before broadcast. The confirmed file remains downloadable. | Club-signed Memo v2 instruction containing `showedup:v1:<salted SHA-256 hash>`. The organizer pays the fee. |
| Verify or apply | A signed wallet read unlocks private files. Applying shares the matching proofs with the receiving club. | The verifier checks the memo and the club’s signature. |
| Use a legacy badge | Existing mint address and claim data | Token-2022 issuance, ownership checks and supported burns still apply. |

Attendance tiers are Showed Up at one event, Regular at three and Core Member at five. Receipt revocation is deferred.

## Configuration

Seven server-only settings, plus one optional public one. In production they're in **Vercel → showedup → Settings → Environment
Variables**; locally they're in `.env.local` (never commit it). See `.env.example`.

| Variable | What it's for |
|---|---|
| `ORGANIZER_SECRET_KEY` | The organizer wallet's secret key (base58 or JSON array). Pays receipt and legacy token fees. Signs for the default club. |
| `EVENT_SECRET` | Any long random string. Signs the rotating QR codes. |
| `ORGANIZER_PASSWORD` | Password of the registry admin, who creates and verifies clubs. Also the default club's passcode (creating events, showing QR codes). |
| `CLUB_KEY_SECRET` | Any long random string (32+ characters). Every other club's Solana wallet is worked out from it and the club's id, so no club key is stored anywhere. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Never change it once clubs exist:** every club would get a new wallet and the badges they already issued would stop counting. |
| `RPC_URL` | Devnet RPC. Use a free [Helius](https://helius.dev) **devnet** URL; the public endpoint rate-limits. The server checks the cluster identity and falls back to the public devnet endpoint if needed. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SECRET_KEY` | Supabase secret key (`sb_secret_…`, Project Settings → API Keys). |
| `PRIVY_APP_ID` (optional) | [Privy](https://dashboard.privy.io) app ID. Lets attendees sign in with email or Google instead of Phantom; a Solana wallet is created for them. Not a secret. Leave empty for Phantom-only. |

| `QUICKNODE_STREAM_TOKEN` (optional) | Security token of the QuickNode Stream that sends claims to `/api/streams/claims`. A secret. See "Live claim feed" below. |

None of the secrets may start with `NEXT_PUBLIC_`: Next.js would copy them into the browser.
After changing a variable in Vercel, redeploy (Deployments → ⋯ → Redeploy) for it to take effect.

### Live claim feed (QuickNode Streams)

The stream recognizes club-signed receipt memos and legacy token claims in devnet blocks. Receipt activity on the home page shows the club, time and transaction. The receipt record and student wallet stay private.

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

The webhook authenticates each delivery and matches receipt observations to a saved transaction signature and memo hash. Repeated deliveries update one receipt. If a delivery arrives before local confirmation finishes, the server checks the transaction on devnet before releasing the file. Check-ins work while the stream is paused.

QuickNode charges credits for every block the stream reads, whether or not it contains a claim.
On a free plan, pause the stream when you're not running an event or a demo.

### Keeping the organizer wallet funded

Creating a private event and checking in consume zero SOL. The organizer pays the transaction fee when a club confirms a contribution. Use the devnet faucet when the app reports an unfunded organizer. [Solana faucet](https://faucet.solana.com)

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

This repository deploys through the Vercel project `aayusks-projects/showed-up`. Check the deployment status on the GitHub commit or in Vercel. [Project deployments](https://vercel.com/aayusks-projects/showed-up/deployments)

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

- **Devnet only.** Independent verification requires the receipt transaction to remain available from a devnet RPC.
- **Codes can be shared for up to about 60 seconds.** A screenshot of the QR works until two
  30-second windows pass. Good enough for a club meeting; a stricter version could shorten the
  window or check location.
- **One shared organizer password** for the club, kept in the browser's session storage after
  it's entered.
- The perks shown on the profile page are sample copy for now.
- `data/events.json` is no longer used (events live in Supabase); it's kept as a backup of the
  first events.
