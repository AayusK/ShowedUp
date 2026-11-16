import "server-only";
import { createHash, timingSafeEqual } from "crypto";

// Compares SHA-256 digests in constant time, so response timing doesn't reveal how much of a
// guessed password was right (and differing lengths don't short-circuit the comparison).
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isOrganizerAuthorized(request: Request): boolean {
  const expected = process.env.ORGANIZER_PASSWORD;
  const given = request.headers.get("x-organizer-password");
  if (!expected || !given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}
