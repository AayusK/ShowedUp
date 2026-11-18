# CLAUDE.md - ShowedUp

Instructions for Claude Code working in this repo. Read this whole file before doing anything,
then read `SPEC.md` (the product spec and the source of truth for what we're building).

---

## 1. How we work together (MOST IMPORTANT)

**Do NOT build the whole app in one go.** We build one step at a time, and I test each step
myself before we move on. For every step:

1. **Say what you're about to do** in a few lines: which step, which files you'll create or
   change, and anything you're unsure about. If a decision is mine to make (see section 7),
   ask before you start.
2. **Implement only that step.** Keep the change small enough that I can test it in a few
   minutes. If a step is big, split it and stop after the first half.
3. **Check your own work first:** run `npm run lint` and `npx tsc --noEmit`, and make sure
   `npm run dev` still starts without errors. Fix anything you broke.
4. **Stop and hand it to me to test.** Give me a short, concrete checklist:
   - exactly what to run (commands), which URL to open, what to click or type
   - what I should see if it works (and what a failure would look like)
   - any setup I need first (e.g. "fund the organizer wallet", "open Phantom on devnet")
5. **Wait for my answer.** Don't start the next step until I say it works. If I report a
   bug, fix that first, then hand it back for another test.
6. **Once I confirm it works, offer to commit** with a clear message. Don't commit or push
   without my OK.

Other rules:
- Don't refactor, restyle or "improve" things outside the current step without asking.
- If something in this file or `SPEC.md` turns out to be wrong or impossible, tell me. Don't
  silently work around it.
- Never print, log, or commit secrets (`.env.local`, `ORGANIZER_SECRET_KEY`).
- Keep `PROMPTS.md` up to date: add a row for each request I give you (date, a short summary,
  notes on the result). It's a log for the hackathon.
- I'm not deep in Solana. When you add blockchain code, explain in a couple of plain sentences
  what it does.

---

## 2. What this is

**ShowedUp**: proof of attendance for our student club on **Solana devnet**. It started as a
practice hackathon project (UBC 2026 prep, Consumer Apps track) and is now in real use by one club.

- An **organizer** creates an event, and a rotating QR code shows up on their laptop/projector.
- An **attendee** scans it with their phone camera; it opens in Phantom, they connect and tap **Claim**.
- The attendee gets 1 **soulbound** (non-transferable) token for that event. The organizer's
  key pays every fee, so attendees never need SOL.
- A **profile page** reads the wallet's tokens from the blockchain and shows a perk tier:
  1 event = Showed Up, 3 = Regular, 5 = Core Member.

Full details: `SPEC.md`. Setup and operations: `README.md`.

## 3. Current state: live and real

**Live:** https://showedup-phi.vercel.app (Vercel, auto-deploys every push to `main`).
**Database:** Supabase project "ShowedUp" (ref `gcgvglojxgaxycbxdach`) in the **CryptoClub**
organization. Tables `events`, `claims` and `members` (wallet → display name, asked once per wallet), RLS on with **no public policies**: only the server's
secret key can read or write them.

| Route | File | What it does |
|---|---|---|
| `/` | `app/page.tsx` → `app/HomeView.tsx` | Hero + the 3 most recent real events |
| `/organizer` | `app/organizer/OrganizerView.tsx` | Password prompt, create event, event list with on-chain attendee counts |
| `/organizer/[id]` | `app/organizer/[id]/CheckinView.tsx` | Rotating QR (Phantom browse link), 30 s countdown, live "N people showed up", "Who’s here" names list |
| `/claim/[eventId]?c=` | `app/claim/[eventId]/ClaimView.tsx` | Name (first claim per wallet) + sign message → claim; ready / success / already claimed / expired screens |
| `/profile/[wallet]` | `app/profile/[wallet]/ProfileView.tsx` | On-chain attendance + tier; `me`/`demo` = connected wallet |
| `/verify` | `app/verify/VerifyView.tsx` | Look up any wallet (linked from My track record, not the header) |
| `/organizer/[id]` (role badge) | `app/organizer/[id]/RecipientsView.tsx` | Who has a contribution badge, "Award to more people", Revoke |
| `/openings/[id]` | `app/openings/[id]/OpeningView.tsx` | Opening with a rule: check, apply with a wallet signature |

Track-record routes (`app/api/`): `GET/POST clubs`, `PATCH clubs/[id]` (admin, verify), `POST events/[id]/award`,
`POST events/[id]/revoke` (club passcode; burns as permanent delegate), `GET/POST openings`,
`openings/[id]/{check,apply,applications}`, `GET feed` (live feed across clubs, no names).

API routes (`app/api/`): `GET/POST events` (`?counts=1` adds attendee counts from mint supply),
`GET events/[id]/code` (password), `GET events/[id]/attendees` (password; names), `POST claim` (saves the name),
`GET members/[wallet]` (has a name yes/no, never the name), `GET profile/[wallet]`, `GET balance/[wallet]`,
`POST organizer/verify` (password check).

Server modules (`lib/server/*`, all `import "server-only"`): `db.ts` (Supabase client),
`events.ts`, `claimsDb.ts` (the per-(event, wallet) claim lock), `mint.ts` (connection, create
mint), `claim.ts` (signature check, mint 1), `code.ts` (rotating codes), `profile.ts`,
`counts.ts`, `members.ts` (names, attendee list), `auth.ts` (constant-time password check), `organizer.ts` (keypair).

Scripts: `npm run organizer` (create the organizer key), `npm run seed -- <wallet> [--target N]`
(gives a wallet up to N of 4 seeded past events; idempotent), `npm run fake-badge -- <wallet>
[--club "<name>"]` (demo: a look-alike Mentor badge from a random wallet; writes nothing to Supabase). Scripts that import `lib/server/*`
run with `tsx --conditions=react-server` (already set in `package.json`).

**Design reference:** the original visual demo (`app/demo.tsx`, deleted; it's in git history)
set the look. Keep its look, copy and CSS class names (`app/globals.css`, plain CSS rather than
Tailwind utilities). **2026-11-18: the owner now allows a real visual and structural redesign (this replaces "Don't redesign anything"); still plain CSS in `globals.css`, one step at a time.** Navigation links must be clearly visible (larger
and/or green): see the "Visible links" block at the end of `globals.css`. Files contain UTF-8
characters like `·`, `→`, `↗`, `’`; keep the encoding intact.

**Known leftovers:** the perks box on the profile still shows sample copy ("Sample perks…");
I'll give the real perks later. `data/events.json` is no longer used (events live in Supabase);
it's kept only as a backup of the first 5 events.

## 4. Tech stack and environment

- **Next.js 15.5 (App Router)**, React 19.1, TypeScript strict, Tailwind v4 via PostCSS (but
  the UI uses plain CSS in `globals.css`). The path alias `@/*` points to the repo root.
- **Webpack, not Turbopack:** `dev` and `build` intentionally leave out `--turbopack`.
  Don't add it back.
- **Solana:** `@solana/web3.js` v1, `@solana/spl-token` 0.4 (Token-2022), `@solana/wallet-adapter-*`,
  `bs58`, `qrcode.react`. Scripts run with `tsx`.
  - **Stay on web3.js v1 and wallet-adapter.** The `solana-dev` skill in `.claude/skills/`
    prefers `@solana/kit` / web3.js v3 and offers migrations. Use it for concepts, Token-2022,
    security and error lookups only. Don't migrate SDKs or add Kit packages. web3.js 3.x is now
    npm `latest`, so always pin `@solana/web3.js@1` if you ever reinstall it.
  - **One exception (Nov 16):** `@solana/kit` and `@solana-program/{memo,system,token}` are
    installed because Privy's Solana support requires them. Our own code must not import them.
- **Sign-in without a wallet app:** `@privy-io/react-auth` v3 (email / Google; Privy creates a
  Solana wallet for the user). Only `components/PrivyBridge.tsx` imports Privy; pages use
  `useEmbeddedWallet()` from `lib/embeddedWallet.ts`. It is off unless `PRIVY_APP_ID` is set.
- **Database:** `@supabase/supabase-js` v2, used **only on the server** with the secret key.
  Never add a browser Supabase client or public RLS policies without asking.
- **Hosting:** Vercel project `showedup` (personal account `ojas-deshmukhs-projects`). The Claude
  Vercel connection can read deployments/logs but couldn't create projects; env vars are set by
  me in the Vercel dashboard, never by Claude.
- **My machine:** Windows 11, PowerShell, Node 24, npm 11. Use PowerShell-friendly commands.
- **Installing packages:** always use `npm install --ignore-scripts`. A transitive dependency
  (`@stellar/stellar-sdk`, pulled in by `@solana/wallet-adapter-wallets`) runs a Unix-only
  install script (`yarn setup || true`), and that breaks `npm install` on Windows.
  - Phantom registers itself as a Wallet Standard wallet, so `WalletProvider wallets={[]}` is
    enough. `@solana/wallet-adapter-wallets` was removed on Nov 16 with the owner's OK: nothing
    imported it, and its Trezor dependency pinned `@solana/kit` 2, which blocked Privy.

Commands:
```bash
npm run dev              # http://localhost:3000 (uses the same Supabase DB + organizer as production)
npm run build            # production build (what Vercel runs)
npm run lint             # note: also lints .claude/claude-skills if present; use `npx eslint app components lib scripts`
npx tsc --noEmit         # typecheck
npm run organizer        # create the organizer keypair (devnet faucet is closed: fund at faucet.solana.com)
npm run seed -- <wallet> # seed past events for a wallet
```

## 5. Environment variables

Locally in `.env.local` (gitignored); in production in Vercel → Settings → Environment Variables.
`.env.example` documents them. **All seven are server-only.** None may be `NEXT_PUBLIC_*`:
Next.js inlines `NEXT_PUBLIC_*` values into browser bundles.

| Var | Used for |
|---|---|
| `ORGANIZER_SECRET_KEY` | base58 secret key (or JSON byte array). Pays all fees for every club; issuer (mint authority) for the default club's events |
| `EVENT_SECRET` | HMAC key for the rotating claim codes |
| `ORGANIZER_PASSWORD` | registry admin password (creates and verifies clubs) and the default club's passcode (`x-organizer-password` header) |
| `CLUB_KEY_SECRET` | 32+ random characters. Each club's keypair is `HMAC-SHA256(CLUB_KEY_SECRET, "club:" + id)` used as the 32-byte seed; nothing is stored. **Changing it orphans every club's badges.** Unset = only the default club can issue |
| `RPC_URL` | devnet RPC (a Helius devnet URL with API key). Falls back to the public devnet endpoint |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Supabase secret (`sb_secret_…`) key; bypasses RLS |

The browser never talks to Solana directly: the wallet balance goes through `/api/balance`, and
the client `ConnectionProvider` gets the public devnet URL (`PUBLIC_DEVNET_RPC` in `lib/solana.ts`).

Vercel also has ~13 `SUPABASE_*` / `POSTGRES_*` vars added by a Supabase integration. The app
doesn't use them.

Also optional and server-only: `QUICKNODE_STREAM_TOKEN`, the security token of the QuickNode
Stream that posts to `/api/streams/claims` (a secret; without it that endpoint answers 503).

Another optional variable: `PRIVY_APP_ID` turns on email / Google sign-in. It is public by
design (not a secret); `app/layout.tsx` reads it on the server and passes it down, so it still
isn't `NEXT_PUBLIC_*`. The server doesn't use `PRIVY_APP_SECRET`.

**This repo's own test setup (`AayusK/ShowedUp`, since Nov 16):** `.env.local` on Aayus's Mac
points at a separate Supabase project "ShowedUp" (ref `vrzcdxhjmdceaheuynpi`, organization
"Impact Developers", same three tables, RLS on, no policies) and a separate organizer wallet
(`Bn38cCVx4BHdZ6Zcx5rqJinMncYcGyqhJeJe3gfvpfce`), so testing never touches the club's live data.

The organizer wallet (`8BdUdmWv4n1DaQMxfPUbVTTtNDd2NqcJz4r9BWkorexu`) needs devnet SOL: about
0.003 SOL per new event and 0.002 SOL per new attendee. The app returns `organizer_unfunded`
when it runs low; I fund it at https://faucet.solana.com. Tell me when a step needs this.

## 6. What's been built (history) and what's next

Built and committed, in order: Steps 0–1 (components, wallet connect), 2 (create event:
Token-2022 NonTransferable mint), 3 (rotating QR), 4 (claim with Phantom `signMessage`
verification), 5 (profile + verify, visible-link styling), 6a (seed script, real on-chain
counts), 6b (README, tunnel, QR opens in Phantom), then the move to real use: hosted step 1
(Supabase), 2 (RPC key server-only), 3 (demo-label cleanup), 4 (Vercel), 5 (docs).

**Hackathon week (this repo, `AayusK/ShowedUp`, started Nov 16 from a copy of the app; each step
was tested by the owner before it was committed):**
- On-chain badge details, part A: `createEventMint(details)` in `lib/server/mint.ts` adds the
  Token-2022 MetadataPointer + TokenMetadata extensions, so new events store name, symbol
  `SHOWEDUP`, `date` and `location` in the mint. Older events have no metadata.
- On-chain badge details, part B: `getProfile` in `lib/server/profile.ts` reads each held token's
  name, date and location from the mint itself, and only accepts mints whose **mint authority is
  the organizer wallet** (a look-alike token from anyone else is ignored). The `events` table is
  a fallback for older events without metadata. If Supabase is unreachable, on-chain badges still
  show and the response has `partial: true`. Each profile event has `source: "chain" | "database"`
  (not shown in the UI yet).
- Sign-in without Phantom, part A: the claim page offers "Sign in to claim" (Privy, email /
  Google) with Phantom as the second option. The embedded wallet signs the same claim message,
  so `/api/claim` is unchanged.
- Sign-in without Phantom, part B: with sign-in on, the check-in QR encodes the plain claim URL
  (not the Phantom link), the header button reads "Sign in" / "Signed in · abcd…wxyz", and
  `/profile/me` works for signed-in users. With `PRIVY_APP_ID` unset, all three behave as before.
- QuickNode Streams, part A (receive and store): `streams/claims-filter.js` runs inside QuickNode
  on every devnet block (dataset "Block") and keeps transactions where the organizer is the fee
  payer and a Token-2022 balance went up. It posts `{ claims: [{ signature, mint, owner,
  blockTime, blockHeight }] }` to `POST /api/streams/claims`, which checks QuickNode's HMAC
  signature (`X-QN-Nonce` + `X-QN-Timestamp` + body, keyed with `QUICKNODE_STREAM_TOKEN`),
  validates every field, keeps only mints from the `events` table and upserts into
  `chain_claims` (SQL in `streams/chain_claims.sql`; signature is the primary key, so repeats
  are harmless). Code: `lib/server/streamClaims.ts`.
- QuickNode Streams, part B (show it): `eventAttendees` in `lib/server/members.ts` merges
  `chain_claims` (by the event's mint) with the app's own `claims` rows, one entry per wallet,
  newest first, each with `source: "stream" | "app"` and a time. Nobody is lost if the stream is
  paused or the table is missing (the app's record still lists them). The check-in page shows
  "N of M seen live on Solana · QuickNode Streams" under "Who's here" when N > 0. The live count
  still comes from the mint's on-chain supply.
- Present mode (UI audit item 16): "Present on a projector" on the check-in page opens a
  full-screen overlay (`.present*` classes at the end of `globals.css`) with a large QR, the
  code, a thick countdown bar, a big attendee count and the latest names. It reuses the page's
  existing state; nothing server-side changed.
- Chosen for the hackathon: Consumer Apps track, Best use of Solana, QuickNode Streams bounty.

**Track record across clubs (Nov 17, branch `feat/track-record` → PR #1, merged; then
`feat/track-record-wave-b`):** Step 0 spec; Step 1 many clubs, each with a derived issuer wallet
and seed-derived badge addresses; Step 2 role badges and "Award contribution"; Step 3 the track
record page by club and term; Step 4 openings with a rule; Wave B: revocation (permanent delegate
burn + `claims.revoked_at`), `npm run fake-badge`, and the live feed across clubs (`/api/feed`).
Schema: `db/01_clubs.sql` … `db/04_revocation.sql`, each safe to run twice.

**Frontend polish in progress:** the full audit (33 numbered items, ⭐ priorities, owner's
constraints, progress log) is in [`docs/UI-AUDIT.md`](docs/UI-AUDIT.md). Read it before any UI
work. The owner picks which items to do; nothing from it is implemented until they say so, and
each finished batch gets a row in its progress log.

Possible next work (ask before starting any of it):
- Real perks on the profile page (waiting on me for the content).
- Live "who's here" list on the check-in page (the `claims` table already has the data).
- Mainnet (would need a new funded organizer key and real-SOL costs; ask first).

## 7. Decisions made (don't revisit without asking)

- **Wallet ownership:** claims require the wallet to sign `ShowedUp claim:<eventId>:<code>:<wallet>`;
  the server rebuilds the message and verifies it with Node's built-in Ed25519 (JWK).
- **Network:** devnet for now.
- **Hosting:** Vercel + Supabase. One club, one shared organizer password.
- **QR:** with sign-in on (`PRIVY_APP_ID` set), encodes the plain claim URL so a camera scan
  opens it in the phone's browser (changed Nov 16, owner's OK). Without sign-in it still encodes
  Phantom's universal browse link (`https://phantom.com/ul/browse/<url>?ref=<origin>`) so the
  scan opens the claim page inside Phantom.
- **Code sharing:** a screenshot of the code works for up to about 60 s. Accepted; noted in the README.
- **Removed** `@solana/wallet-adapter-wallets` (Nov 16).
- **Sign-in:** Privy for email / Google with an embedded Solana wallet; Phantom stays as an option.
- **Clubs:** each club's keypair is `HMAC-SHA256(CLUB_KEY_SECRET, "club:" + id)` as the seed, never
  stored. The organizer pays every fee; the club key signs only as authority.
- **Badge addresses:** new mints live at `createWithSeed(clubIssuer, eventId, TOKEN_2022_PROGRAM_ID)`,
  so only that club could have created them (`judgeBadge` in `lib/server/profile.ts` re-derives it).
  Older default-club badges count only if the `events` table lists them.
- **Revocation:** new mints have Permanent Delegate = the club's issuer; revoking burns the token
  and sets `claims.revoked_at`. Older badges can't be revoked. A revoked badge can't be re-awarded
  to the same wallet (the claims row stays as the lock).
- **Copy:** say "track record", never "background check". Records are positive only; no student
  name on-chain (club names are fine).

## 8. Gotchas

- Always pass `TOKEN_2022_PROGRAM_ID` to every spl-token helper. The default is the *old* token
  program, and mixing the two produces confusing "account not found" or "invalid owner" errors.
- Wallet adapter hooks only work in client components (`"use client"`). Keep `Connection` and
  `Keypair` code that uses the secret on the server.
- If web3.js complains about a missing `Buffer` in the browser, add a small polyfill rather than
  changing bundlers.
- The public devnet RPC rate-limits hard (429s). We use Helius via the server-only `RPC_URL`;
  keep the one-retry backoff in `withRetry`.
- Use `confirmTransaction` with the `{ signature, blockhash, lastValidBlockHeight }` form, at
  `"confirmed"` commitment.
- Vercel runs several server instances: in-memory locks/state don't work. Use the `claims` table.
- The Supabase and production data are real app state: don't wipe tables, delete events or
  hand-edit rows unless I ask.
- Before committing, check the staged diff for the **actual values** in `.env.local`, not just
  `KEY=` patterns (the README contains `ORGANIZER_SECRET_KEY=…` as an example).
