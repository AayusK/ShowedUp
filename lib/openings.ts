// Openings: a club posts a role with a rule ("1 or more Mentor badges from a verified club") and
// students apply with their track record. Shared by the browser and the server; nothing secret
// lives in this file.
import type { ReceiptFile } from "@/lib/receipt";
import type { Role } from "@/lib/badges";
import type { ProfileEvent } from "@/lib/profileClient";

export const OPENING_ID_RE = /^[a-z0-9]{8}$/;
export const OPENING_TITLE_MAX = 80;
export const OPENING_DESCRIPTION_MAX = 600;
export const MIN_COUNT_MIN = 1;
export const MIN_COUNT_MAX = 50;

/** An opening as anyone may see it. It never carries a student's name. */
export interface OpeningInfo {
  id: string;
  clubId: string;
  clubName: string;
  title: string;
  description: string | null;
  /** Which role counts toward the rule. null = a verified badge of any role. */
  role: Role | null;
  /** How many matching badges the rule asks for (1 to 50). */
  minCount: number;
  /** When it stops taking applications (ISO time), or null if it stays open. */
  closesAt: string | null;
  createdAt: string;
  /** Worked out by the server when it answered: true once `closesAt` has passed. */
  closed: boolean;
}

/** An officer's view of their club's opening: the same, plus how many people applied. */
export interface ClubOpening extends OpeningInfo {
  applications: number;
  pending: number;
}

export type ApplicationStatus = "pending" | "accepted" | "declined";
export const DECISIONS = ["accepted", "declined"] as const;
export type Decision = (typeof DECISIONS)[number];

/** A badge that counted toward a rule. Everything here is already public on the track record. */
export interface CountedBadge {
  name: string;
  club: string;
  role: Role;
  date: string;
  /** The badge's token address on Solana, for the Explorer link. */
  mint: string | null;
  receiptFile?: ReceiptFile;
}

/** The answer to "does this wallet meet the rule?". */
export interface RuleCheck {
  qualifies: boolean;
  /** How many of the wallet's verified badges match the rule. */
  counted: number;
  needed: number;
  /** How many more are needed. 0 when the wallet qualifies. */
  remaining: number;
  /** The badges that counted, newest first (a long list is cut short; `counted` is the full number). */
  badges: CountedBadge[];
  /** Set when the database couldn't be reached, so some badges may be missing from the count. */
  partial?: boolean;
}

/** What an officer sees about an applicant's record: how many badges counted, and from which clubs. */
export interface ApplicantSummary {
  counted: number;
  qualifies: boolean;
  byClub: { club: string; count: number }[];
  /** A few of the badges that counted, each with its token address for the Explorer link. */
  badges: CountedBadge[];
}

export interface Applicant {
  wallet: string;
  /** The name the student saved. Only the officers of the club they applied to get this. */
  name: string | null;
  status: ApplicationStatus;
  appliedAt: string;
  /** null if the record couldn't be read from Solana just now. */
  summary: ApplicantSummary | null;
}

/**
 * The exact text a student's wallet signs to apply. Shared by the opening page (which asks the
 * wallet to sign it) and the server (which rebuilds it and checks the signature). Signing is
 * free and sends nothing to the blockchain: it only proves the applicant controls that wallet.
 */
export function applyMessage(openingId: string, wallet: string): string {
  return `ShowedUp apply:${openingId}:${wallet}`;
}

/** The rule in plain words: "1 or more Mentor badges from a verified club". */
export function ruleSentence(role: Role | null, minCount: number): string {
  // "or more" always reads plural: "1 or more Mentor badges".
  return role
    ? `${minCount} or more ${role} badges from a verified club`
    : `${minCount} or more badges of any kind from a verified club`;
}

/**
 * The badges that count toward a rule. `events` is the verified part of a track record as read
 * from Solana (see getProfile): tokens whose issuer is a verified club. A badge counts when its
 * role is the opening's role, or always when the opening accepts any role. Badges from every
 * verified club are counted together.
 */
export function badgesTowardRule(events: ProfileEvent[], role: Role | null): ProfileEvent[] {
  return events.filter((e) => e.club.verified && e.source !== "checkin" && (role === null || e.role === role));
}

export function isClosed(closesAt: string | null, now = Date.now()): boolean {
  if (!closesAt) return false;
  const at = Date.parse(closesAt);
  return Number.isFinite(at) && at <= now;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 20, 2026" in the reader's own timezone. Call it in the browser only (after mount). */
export function formatClosingDay(closesAt: string): string {
  const d = new Date(closesAt);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
