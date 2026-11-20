# ShowedUp — Spec

**UBC 2026 hackathon · Track: Consumer Apps · Best use of Solana · QuickNode Streams bounty · Chain: Solana devnet · Started as an attendance demo (Nov 4), in real use by one club, now a track record across clubs**

## Problem
Students do real work for clubs: they mentor, speak, volunteer and run events. The proof sits in one club's spreadsheet or one officer's memory, and it disappears when that officer graduates. When the student approaches a second club, that club can't check any of it, so mentors and leads get picked on word of mouth.

## User
- **Student:** owns their track record. A phone and an email sign-in (or Phantom) is enough. They don't need SOL and don't need to understand crypto.
- **Issuing club officer:** runs private check-ins and confirms contributions with the club’s Solana wallet.
- **Deciding club officer:** posts an opening with a rule and picks people from records they can verify themselves.
- **Registry admin:** creates clubs and marks the real ones as verified.

## Core feature
A student checks in with a rotating QR code. An officer can select a checked-in student, describe their contribution and assign a role such as Mentor or Volunteer. The club signs one receipt per event, wallet and role. The student’s track record groups contributions by club and term, and the student chooses which downloaded receipts to share.

A second club can post an opening with a rule such as “one Mentor contribution from a verified club.” The student signs to check the rule, then applies to share the matching proof. Records are positive only.

## Evidence and privacy

| Record | Storage and access |
|---|---|
| Attendance | Supabase holds the event, wallet and check-in. The student and the issuing club’s officers can see the check-in. Counts can be shown publicly. |
| Contribution | Supabase holds the approved event, role, description and student wallet. The downloadable JSON includes the salt, issuer, memo hash and transaction signature. |
| Public receipt proof | Only a salted hash goes in the memo. The club signs, the organizer pays, and an independent verifier can check the downloaded file against a trusted club address. |
| Opening | The server verifies the applicant’s receipt against the club registry and devnet. Applying shares the matching records with the receiving club’s officers. |
| Legacy token | Existing attendance and role tokens still appear on public profiles. Token revocation applies to mints that support it. |

## Demo

1. An officer creates a workshop and displays the check-in QR.
2. A student signs in, scans twice and appears once in the club roster.
3. The officer confirms the student’s Mentor contribution. The student downloads it from their private track record.
4. Verify the file against the club’s address. Change the summary in a copy and verify it again to see the edit detected.
5. The student qualifies for a second club’s Mentor opening and signs to apply. Its officers can inspect the matching receipt and accept the application.

## Decisions made
- **Stack unchanged:** Next.js 15 App Router, Webpack, `@solana/web3.js` v1 + spl-token 0.4, Supabase on the server only, Vercel.
- **Club wallets are derived, not stored:** `HMAC-SHA256(CLUB_KEY_SECRET, "club:" + id)` is the key's 32-byte seed. The server holds that secret, so whoever runs the server could issue as any club; a club holding its own key is future work.
- **The organizer wallet pays every fee**, so the QuickNode filter can recognize app-issued transactions across clubs.
- **Legacy club:** events from before clubs existed belong to one default club whose issuer is the organizer wallet; `ORGANIZER_PASSWORD` is its passcode and the registry admin password.
- **Auth:** every club action sends `x-club-id` + `x-organizer-password`; passcodes are stored as scrypt hashes with a per-club salt.
- **Privacy:** names stay in the database and are shown only to officers: of a club the student checked in to, or one they applied to (applying is the consent).
- **Tiers** (1 = Showed Up, 3 = Regular, 5 = Core Member) still count attendance only.
- **Receipts instead of tokens (Nov 17, owner's call):** new events mint no tokens. Check-ins, roles and contributions stay in the database, so rosters are private. When an officer confirms a contribution, the server writes a salted SHA-256 hash of the record to devnet as a memo (`showedup:v1:<hash>`, Memo program v2), signed by the club's key and paid by the organizer wallet. The student downloads the record, its salt and the transaction signature; anyone who trusts the club's address can check it against Solana alone (`lib/receipt.ts`, `npm run receipt:verify`). A record names the student's wallet, so a copied file is no use to anyone else. Older events keep their tokens. Taking back a receipt comes later. Receipts cover one event, student wallet and role.
- **Out of scope:** payments, voting, a custom Solana program, the Solana Attestation Service, mainnet.
