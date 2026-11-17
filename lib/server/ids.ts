import "server-only";
import { randomBytes } from "crypto";

// Short random ids for events and clubs (8 characters, no look-alikes such as 0/o or 1/l).
const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newId(): string {
  return Array.from(randomBytes(8), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}
