import "server-only";
import { createHash, timingSafeEqual } from "crypto";
import { LEGACY_CLUB_ID } from "@/lib/clubs";
import { checkClubPasscode, legacyClub, type ClubRecord } from "./clubs";
import type { EventRecord } from "./events";

// Two kinds of access:
//  - the registry admin, who creates clubs and marks them verified (ORGANIZER_PASSWORD)
//  - a club's officers, who act for one club (that club's passcode)
// The default club's passcode is ORGANIZER_PASSWORD, so the flow from before clubs existed
// (one shared password, no club id) still works unchanged.

// Compares SHA-256 digests in constant time, so response timing doesn't reveal how much of a
// guessed password was right (and differing lengths don't short-circuit the comparison).
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function matchesOrganizerPassword(given: string | null): boolean {
  const expected = process.env.ORGANIZER_PASSWORD;
  if (!expected || !given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/** True if the request carries the registry admin password. */
export function isAdminAuthorized(request: Request): boolean {
  return matchesOrganizerPassword(request.headers.get("x-organizer-password"));
}

/**
 * Which club this request may act for: `x-club-id` names the club and `x-organizer-password`
 * carries its passcode. No club id means the default club. Returns null if the passcode is
 * wrong or the club doesn't exist. Throws only if the database can't be reached.
 */
export async function authorizeClub(request: Request): Promise<ClubRecord | null> {
  const given = request.headers.get("x-organizer-password");
  if (!given) return null;
  const clubId = request.headers.get("x-club-id")?.trim() || LEGACY_CLUB_ID;
  if (clubId === LEGACY_CLUB_ID) return matchesOrganizerPassword(given) ? legacyClub() : null;
  return checkClubPasscode(clubId, given);
}

/** The club an event belongs to. Events from before clubs existed belong to the default club. */
export function eventClubId(event: Pick<EventRecord, "clubId">): string {
  return event.clubId ?? LEGACY_CLUB_ID;
}

/** A club may only act on its own events. */
export function ownsEvent(club: ClubRecord, event: Pick<EventRecord, "clubId">): boolean {
  return eventClubId(event) === club.id;
}
