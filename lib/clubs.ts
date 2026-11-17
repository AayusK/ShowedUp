// Clubs, as the browser and the server both see them. Nothing secret lives in this file.

/**
 * The default club: every event created before clubs existed belongs to it. Its issuer is the
 * organizer wallet and its passcode is ORGANIZER_PASSWORD. The id contains an "o", which the
 * random ids never use, so a new club can't collide with it.
 */
export const LEGACY_CLUB_ID = "showedup";

/** The default club's display name. Edit this one line to rename it. */
export const LEGACY_CLUB_NAME = "UBC Builders Club";

export const CLUB_ID_RE = /^[a-z0-9]{8}$/;
export const CLUB_NAME_MAX = 40;
export const PASSCODE_MIN = 8;
export const PASSCODE_MAX = 100;
/** Passcodes travel in an HTTP header, so they must be plain keyboard characters. */
export const PASSCODE_RE = /^[\x21-\x7e]([\x20-\x7e]*[\x21-\x7e])?$/;

export interface ClubInfo {
  id: string;
  name: string;
  /** The club's Solana address. Every badge the club issues names this address as its issuer. */
  issuer: string;
  /** Set by the registry admin. Only badges from verified clubs count on a track record. */
  verified: boolean;
}

/** Trims, collapses whitespace and strips control characters. Returns "" if nothing usable is left. */
export function cleanClubName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, CLUB_NAME_MAX);
}

export function isValidPasscode(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length >= PASSCODE_MIN && raw.length <= PASSCODE_MAX && PASSCODE_RE.test(raw);
}
