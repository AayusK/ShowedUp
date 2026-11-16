import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// Rotating claim codes. Nothing is stored: the code for any 30-second window is
// recomputed from EVENT_SECRET, so only the server can produce valid codes.

export const CODE_WINDOW_MS = 30_000;
// 32 easy-to-read characters (no 0/O/1/I). 256 % 32 === 0, so every character is equally likely.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

function secret(): string {
  const s = process.env.EVENT_SECRET;
  if (!s) throw new Error("EVENT_SECRET is not set");
  return s;
}

function codeForWindow(eventId: string, window: number): string {
  const digest = createHmac("sha256", secret()).update(`${eventId}:${window}`).digest();
  return Array.from(digest.subarray(0, CODE_LENGTH), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** The code to show right now, and how many seconds until it changes. */
export function currentCode(eventId: string, now = Date.now()): { code: string; expiresIn: number } {
  const window = Math.floor(now / CODE_WINDOW_MS);
  const msLeft = (window + 1) * CODE_WINDOW_MS - now;
  return { code: codeForWindow(eventId, window), expiresIn: Math.ceil(msLeft / 1000) };
}

/** True if `code` matches the current or the previous window (so a code lasts 30–60 s). */
export function isValidCode(eventId: string, code: string, now = Date.now()): boolean {
  const given = Buffer.from(code.trim().toUpperCase());
  if (given.length !== CODE_LENGTH) return false;
  const window = Math.floor(now / CODE_WINDOW_MS);
  return [window, window - 1].some((w) => timingSafeEqual(given, Buffer.from(codeForWindow(eventId, w))));
}
