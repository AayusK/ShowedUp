// Turns a wallet's verified badges into a track record: by club, then by term.
// Safe for the browser: types and plain functions only.
import { CONTRIBUTION_ROLES, type Role } from "@/lib/badges";
import type { ClubInfo } from "@/lib/clubs";
import { formatDay, formatEventDetail } from "@/lib/format";
import type { ProfileEvent, UnverifiedBadge } from "@/lib/profileClient";

const SEASONS = ["Spring", "Summer", "Fall"] as const;

export interface Term {
  /** "Fall 2026" */
  label: string;
  /** Bigger = more recent. Used only for sorting. */
  order: number;
}

/**
 * The term a badge belongs to: Spring (Jan–Apr), Summer (May–Aug) or Fall (Sep–Dec) plus the year.
 * Dates are local wall-clock "YYYY-MM-DDTHH:mm", so the month is read straight from the text
 * (no Date, no time zones). Returns null if the text isn't a date.
 */
export function termOf(date: string): Term | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const season = Math.floor((month - 1) / 4);
  return { label: `${SEASONS[season]} ${year}`, order: year * 3 + season };
}

export interface TermGroup {
  /** "Fall 2026", or "Undated" for a badge whose date can't be read. */
  label: string;
  order: number;
  /** Newest first. */
  events: ProfileEvent[];
}

export interface ClubGroup {
  club: ClubInfo;
  /** Newest term first. */
  terms: TermGroup[];
}

/** Groups badges by club (most recently active club first), then by term (newest first). */
export function groupTrackRecord(events: ProfileEvent[]): ClubGroup[] {
  // Newest first. The dates are fixed-width text, so comparing the text compares the time.
  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));
  const clubs = new Map<string, ClubGroup>();
  for (const e of sorted) {
    // Clubs are created in the order of their newest badge, which is the order we show them in.
    let group = clubs.get(e.club.id);
    if (!group) { group = { club: e.club, terms: [] }; clubs.set(e.club.id, group); }
    const term = termOf(e.date);
    const label = term?.label ?? "Undated";
    let bucket = group.terms.find((t) => t.label === label);
    if (!bucket) { bucket = { label, order: term?.order ?? -1, events: [] }; group.terms.push(bucket); }
    bucket.events.push(e);
  }
  const groups = [...clubs.values()];
  for (const g of groups) g.terms.sort((a, b) => b.order - a.order);
  return groups;
}

function times(n: number) {
  return n === 1 ? "once" : `${n} times`;
}

const ROLE_PHRASE: Record<Exclude<Role, "Attendee">, (n: number) => string> = {
  Volunteer: (n) => `volunteered ${times(n)}`,
  Speaker: (n) => `spoke ${times(n)}`,
  Mentor: (n) => `mentored ${times(n)}`,
  Organizer: (n) => `organized ${times(n)}`,
  Officer: (n) => `served as an officer ${times(n)}`,
};

/** ["6 meetings", "mentored 3 times"]: attendance first, then one phrase per contribution role. */
export function roleCounts(events: ProfileEvent[]): string[] {
  const byRole = new Map<Role, number>();
  let meetings = 0;
  for (const e of events) {
    if (e.kind === "contribution" && e.role !== "Attendee") byRole.set(e.role, (byRole.get(e.role) ?? 0) + 1);
    else meetings += 1;
  }
  const parts: string[] = [];
  if (meetings > 0) parts.push(`${meetings} ${meetings === 1 ? "meeting" : "meetings"}`);
  for (const role of CONTRIBUTION_ROLES) {
    const n = byRole.get(role) ?? 0;
    if (n > 0 && role !== "Attendee") parts.push(ROLE_PHRASE[role](n));
  }
  return parts;
}

/** "Builders Club · Fall 2026 · 6 meetings · mentored 3 times" */
export function termSummary(clubName: string, term: TermGroup): string {
  return [clubName, term.label, ...roleCounts(term.events)].join(" · ");
}

/**
 * The line under a badge's name. Contribution badges are saved with a placeholder time, so they
 * show the day only; attendance badges show the day, the time and the place.
 */
export function badgeDetail(e: ProfileEvent): string {
  if (!termOf(e.date)) return e.location ?? "";
  if (e.kind === "contribution") return [formatDay(e.date), e.location].filter(Boolean).join(" · ");
  return formatEventDetail(e.date, e.location);
}

/** The day an unverified token claims, or a plain note when it can't be read. */
export function unverifiedDay(date: string): string {
  return termOf(date) ? formatDay(date) : "Date not readable";
}

/** In plain words, why a look-alike or not-yet-verified token isn't counted. */
export function unverifiedReason(b: UnverifiedBadge): string {
  if (b.reason === "club_not_verified") {
    return b.club
      ? `Issued by ${b.club}, which hasn’t been verified yet.`
      : "Issued by a registered club that hasn’t been verified yet.";
  }
  if (b.reason === "address_mismatch") {
    return b.club
      ? `It names ${b.club}, but that club’s wallet didn’t create it.`
      : "It names a registered club’s wallet, but that wallet didn’t create it.";
  }
  return b.club
    ? `It names ${b.club}, but it was created by a wallet that isn’t a registered club.`
    : "Created by a wallet that isn’t a registered club.";
}
