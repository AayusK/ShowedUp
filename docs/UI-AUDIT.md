# ShowedUp UI/UX polish audit

**Date:** 2026-11-05 · **Status:** audit done; item 16 implemented (see the progress log), the rest waiting for the owner to pick.

This is Phase 1 of the frontend polish request. Phase 2 = implement the items the owner approves,
3–6 at a time, grouped by page or theme, with lint + typecheck + desktop/mobile screenshots after
each batch (see CLAUDE.md section 1).

## Constraints for Phase 2 (from the owner, non-negotiable)

- ~~Not a redesign. Keep the visual identity: colors, fonts, layout, copy tone, CSS class names.~~ **2026-11-18: lifted by the owner. A real visual and structural redesign is allowed; the other constraints below still apply.**
- Styling stays in plain CSS in `app/globals.css` (no Tailwind utility rewrites, no CSS-in-JS).
- No new dependencies without asking first.
- Frontend only: don't touch `app/api/*`, `lib/server/*`, or any Solana/transaction logic.
- Keep UTF-8 characters (`·`, `→`, `↗`, `’`) intact.
- If a fix would change how something looks in a big way (marked 🔍), ask first.

## How the audit was done

- Playwright browser (the built-in browser wasn't available), every route at desktop (1280px),
  phone (375px) and projector (1280×720). Screenshots in `.playwright-mcp/audit/` (gitignored).
- `web-design-guidelines` skill review of `components/`, `app/**/*View.tsx`, `app/globals.css`.
- No console errors on any page. Phantom's in-app browser can't run in Playwright, so
  connected-wallet and claim-success screens were reviewed from code.
- The CSS has no dark-mode rules (light-only app), so there was no dark mode to check.

## Legend

⭐ = do first (real bug or noticeable UX problem) · **S** = small · **M** = medium ·
🔍 = visibly changes the look (confirm with the owner first)

Suggested order for the ⭐ items: 33, 1, 2, 4, 5, 12, 20, 25, 26, then 16 (projector mode, the biggest).

## Global (all pages)

1. ⭐ **Header wraps on phones.** At 375px the nav drops to a second line (header 105px tall). → Keep it one tidy row (tighter gaps, smaller logo) or make the second row deliberate. **S 🔍**
2. ⭐ **Phone wallet button has no accessible name.** Icon-only 36×36 (its text is `display:none`), so screen readers announce nothing. → `aria-label` + 44px size. **S**
3. **Wallet menu.** No Esc to close, no `aria-expanded`/`aria-haspopup`, no copy-address. → Esc + aria + "Copy address" item with "Copied!" feedback. **S**
4. ⭐ **Focus rings.** Keyboard focus uses the browser's default black ring (thick black on inputs, e.g. `/verify`). → One green `:focus-visible` ring for buttons, links and inputs. **S**
5. ⭐ **Tap targets under 44px on phones.** Header links 38px, organizer row buttons ~30px, pill buttons 38px, "View on Explorer" link 18px tall, modal × close. → `min-height: 44px` / padding in the phone CSS. **S**
6. **Tiny grey text.** 9–10px in event cards, badges, footer, step instructions, claim notes, countdown. → Raise the smallest to 11–12px. **S 🔍**
7. **Every tab is titled "ShowedUp".** → Per-page titles ("Organizer · ShowedUp", "Builders Meeting · ShowedUp"). **S**
8. **Unused Geist fonts.** `app/layout.tsx` downloads Geist but `body` uses Arial. → Remove it (faster load, no visual change). **S**
9. **No `theme-color`, no `color-scheme: light`.** A phone in dark mode can half-darken inputs. → Add both, plus `touch-action: manipulation` on buttons/links. **S**
10. **Address formatting in two places.** `WalletButton` slices addresses itself instead of `shortAddress` (`lib/profileClient.ts`). → One helper. **S**
11. **Status updates not announced.** Claim result, verify result and the live count changes. → `aria-live="polite"` regions. **S**

## Claim page (`/claim/[eventId]`, phone inside Phantom)

12. ⭐ **Two taps to claim.** After "Connect wallet to claim" and choosing Phantom, the attendee must tap again. → Continue to the signature step automatically once connected. **S**
13. **No success moment.** → Small CSS "pop" on the check mark and a soft ring; off under `prefers-reduced-motion`. **S**
14. **No safe-area padding** for the iPhone home bar. → `padding-bottom: env(safe-area-inset-bottom)`. **S**
15. **Expired screen.** The only button is "Back to overview". → Lead with "Scan the organizer's latest QR"; make the button secondary. **S**

Already good: no horizontal scroll at 375px, primary button within thumb reach (~650px of 812),
busy labels and double-tap protection work.

## Check-in page (`/organizer/[id]`, projector)

16. ⭐ **Too small for a projector.** Measured at 1280×720: QR **224px**, code **13px**, countdown **10px** text over a **3px** bar. → A "Present" full-screen mode: QR ~60% of screen height, code ~40px, thick countdown bar, big attendee count, header hidden. **M 🔍**
17. **First load.** "Refreshes in 30s" shows before any code exists; the first code took 10+ s locally (dev compile). → Show the countdown only once a code exists; calm placeholder until then. **S**
18. **Rotation isn't signposted.** → Shift the bar's colour slightly in the last 5 seconds. **S**
19. **Count updates are silent.** → Gentle bump animation + `aria-live` when the count goes up. **S**

## Organizer page (`/organizer`)

20. ⭐ **Layout jump while loading.** The stats box is full width with "–", then splits into 2 columns. → Reserve the 2-column layout from the start. **S**
21. **"Organizer access" renders small and grey.** Another rule (inside `.organizer-access`) overrides the visible-link style. → Fix the override. **S**
22. **No confirmation after creating an event.** The modal just closes. → "Event created" note, highlighted row, "Open check-in" button. **S**
23. **Modals (password + create event).** No focus trap, focus doesn't return to the trigger, not labelled by their heading. → Focus trap, return focus, `aria-labelledby`. **M**
24. **"Needs devnet SOL" error.** The organizer address can't be copied easily. → Copy button. **S**

## Profile (`/profile/[wallet]`)

25. ⭐ **Tier line shows no progress.** The whole line is one colour at 1 or 4 events. → Fill it up to the current count (progress bar toward the next tier). **S**
26. ⭐ **Flash of "Connect your wallet" on `/profile/me`** while Phantom auto-reconnects. → Wait for the wallet's reconnect state before deciding. **S**
27. **Loading copy says "Gathering *your* attendance…"** even for someone else's wallet. → Neutral copy for other wallets. **S**
28. **No Copy button** next to the short address. **S**
29. **No tier-unlock moment.** → Small "Core Member unlocked" highlight the first time a new tier is seen. **M**

## Verify (`/verify`)

30. **Mobile keyboard.** iPhones capitalise/autocorrect pasted addresses; the error isn't linked to the field. → `autoCapitalize="off"`, `autoCorrect="off"`, `aria-invalid`, `aria-describedby`. **S**
31. **Invalid addresses only caught by the server** (a 400 in the console). → Check the base58 format in the browser first for an instant error. **S**
32. **No "Copy profile link"** on the result, and the result isn't announced. **S**

## Home (`/`)

33. ⭐ **Timezone bug.** "Checking in today" / "Past event" are computed during server rendering on Vercel (UTC). In the evening (Pacific) the label can be wrong or cause a hydration warning. → Compute them in the browser after load. **S**

## Progress log

Record each implemented batch here (date, item numbers, commit), so the next session knows what's left.

| Date | Items | Commit | Notes |
|---|---|---|---|
| 2026-11-16 | 16 | (see git log: "Add full-screen Present mode") | "Present on a projector" button on the check-in page opens a full-screen layout (also asks the browser for real full screen; Esc or Exit leaves). Measured at 1280×720: QR box 475px (66% of height), code 40px, countdown bar 12px, attendee count 115px, latest 6 names, no scrolling. New CSS classes are prefixed `present-`; the normal page is unchanged apart from the button. |
