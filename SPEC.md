# ShowedUp — Spec

**UBC 2026 hackathon · Track: Consumer Apps · Best use of Solana · QuickNode Streams bounty · Chain: Solana devnet · Started as an attendance demo (Nov 4), in real use by one club at https://showedup-phi.vercel.app, now a track record across clubs**

## Problem
Students do real work for clubs: they mentor, speak, volunteer and run events. The proof sits in one club's spreadsheet or one officer's memory, and it disappears when that officer graduates. When the student approaches a second club, that club can't check any of it, so mentors and leads get picked on word of mouth.

## User
- **Student:** owns their track record. A phone and an email sign-in (or Phantom) is enough. They don't need SOL and don't need to understand crypto.
- **Issuing club officer:** records who showed up and what people did, from the club's own Solana wallet.
- **Deciding club officer:** posts an opening with a rule and picks people from records they can verify themselves.
- **Registry admin:** creates clubs and marks the real ones as verified.

## Core feature
A club officer awards **role badges** (Attendee, Volunteer, Speaker, Mentor, Organizer, Officer) from the club's own wallet: attendance through the rotating QR code, contributions by picking people who checked in. The student's **track record** page groups those badges by club and term, each one linked to Solana. The student shares it with a second club. That club posts an opening with a rule ("1 or more Mentor badges from a verified club"), the student checks whether they qualify and applies, and the officer accepts from a record nobody had to take on trust.

Two rules for every screen: we say **track record**, and records are **positive only**. A club can take back a badge it issued by mistake; nobody can add a negative mark.

## Why blockchain
- **The student owns it:** badges live in the student's wallet, not in any club's database. They outlast officers, clubs and this app.
- **Anyone can check who issued it:** each badge's address is derived from the issuing club's wallet, so only that club could have created it. A look-alike from another wallet shows as "Unverified issuer" and isn't counted.
- **Can't be traded or bought:** Token-2022 **NonTransferable** extension (soulbound).
- **Free for users:** the organizer wallet pays every fee. Students and clubs never need SOL.

## On-chain vs off-chain
| On-chain (Solana devnet) | Off-chain (Next.js server + Supabase) |
|---|---|
| One Token-2022 mint per badge: 0 decimals, NonTransferable, Permanent Delegate (so the issuing club can revoke), the club's wallet is mint authority. Its address is derived from the club's wallet and the badge id. | `clubs`: id, name, issuer address, passcode hash, verified. Club keys are never stored: each is derived from `CLUB_KEY_SECRET` and the club id. |
| Metadata in the mint: name, symbol `SHOWEDUP`, `date`, `location`, `id`, `kind` (attendance or contribution), `role`, `club`. **Never a student's name.** | `events` (one row per badge, with its club, kind and role), `claims` (the per-wallet lock and log), `members` (wallet → display name, shown only to officers). |
| Each award: create the student's token account if needed, mint 1. The club's key signs as the authority, the organizer wallet pays. | Rotating claim code: `HMAC(EVENT_SECRET, eventId + 30 s window)`, 6 characters. Claims and applications need a wallet signature. |
| The track record is read from the chain: every token the wallet holds whose issuer is a verified club. | `openings` and `applications`; `chain_claims`, filled live by a QuickNode Stream watching devnet. |

API: `GET/POST /api/clubs`, `GET/POST /api/events`, `POST /api/events/[id]/award`, `POST /api/claim`, `GET /api/profile/[wallet]`, `/api/openings`, `GET /api/feed`.

## Demo script (2 min)
1. The admin creates two verified clubs.
2. An officer of the first club creates a workshop and awards a **Mentor** badge to a student who checked in.
3. The student's track record shows it under that club and term, with a link to Solana.
4. The second club posts "Hackathon mentor: 1 or more Mentor badges from a verified club". The student checks, qualifies and applies.
5. The second club's officer sees the application with the verified record and accepts.
6. A fake Mentor badge from a random wallet shows as "Unverified issuer". The first club revokes a badge and it disappears from the record.

## Parts
0. Spec (this file)
1. Many clubs, each with its own issuer wallet; a registry admin; badges whose address proves the issuer
2. Role badges and "Award contribution"
3. Track record page: by club and term, counts by role, share link and QR
4. Openings with a rule: check, apply with a signature, accept or decline
5. Revocation, the fake-issuer demo script, the live feed across clubs (QuickNode Streams)

## Decisions made
- **Stack unchanged:** Next.js 15 App Router, Webpack, `@solana/web3.js` v1 + spl-token 0.4, Supabase on the server only, Vercel.
- **Club wallets are derived, not stored:** `HMAC-SHA256(CLUB_KEY_SECRET, "club:" + id)` is the key's 32-byte seed. The server holds that secret, so whoever runs the server could issue as any club; a club holding its own key is future work.
- **The organizer wallet pays every fee**, so the QuickNode filter (fee payer) keeps catching every award from every club.
- **Legacy club:** events from before clubs existed belong to one default club whose issuer is the organizer wallet; `ORGANIZER_PASSWORD` is its passcode and the registry admin password.
- **Auth:** every club action sends `x-club-id` + `x-organizer-password`; passcodes are stored as scrypt hashes with a per-club salt.
- **Privacy:** names stay in the database and are shown only to officers: of a club the student checked in to, or one they applied to (applying is the consent).
- **Public profile (opt-in, Nov 20):** a student may add a name, headline, school, bio, LinkedIn/links and skills to their track record (`profiles` table, `db/06_profiles.sql`). It stays hidden until they switch it on, saving needs a wallet signature, and it never goes on-chain.
- **Tiers** (1 = Showed Up, 3 = Regular, 5 = Core Member) still count attendance only.
- **Out of scope:** payments, voting, a custom Solana program, the Solana Attestation Service, mainnet.
