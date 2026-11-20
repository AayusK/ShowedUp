// Offline checks for the pure logic behind the demo: profile rules, track record grouping, tiers,
// chat sign-in tokens, wallet signatures and the rotating check-in code. No network, no database.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

process.env.EVENT_SECRET ??= "test-event-secret-0123456789abcdef";

import { cleanCard, cardSaveMessage, isEmptyCard, EMPTY_CARD } from "../lib/profileCard";
import { termOf, groupTrackRecord, roleCounts } from "../lib/trackRecord";
import { getTier, getNextTier } from "../lib/tiers";
import { cleanText, chatSignInMessage } from "../lib/chat";
import { issueMemberToken, readMemberToken } from "../lib/server/chat";
import { verifyWalletSignature } from "../lib/server/claim";
import { currentCode, isValidCode, CODE_WINDOW_MS } from "../lib/server/code";
import type { ProfileEvent } from "../lib/profileClient";

/** A throwaway Ed25519 wallet: its base58 address and a function that signs text like Phantom. */
function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "jwk" }).x!;
  const address = new PublicKey(Buffer.from(raw, "base64url")).toBase58();
  return { address, sign: (text: string) => bs58.encode(edSign(null, Buffer.from(text, "utf8"), privateKey)) };
}

test("profile: keeps tidy fields and https links", () => {
  const r = cleanCard({ displayName: "  Priya   Sharma ", headline: "CS\tstudent", links: ["https://www.linkedin.com/in/p", ""], skills: ["Rust", "Rust", " Figma "], gradYear: "2028", isPublic: true });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.card.displayName, "Priya Sharma");
  assert.equal(r.card.headline, "CS student");
  assert.deepEqual(r.card.links, ["https://www.linkedin.com/in/p"]);
  assert.deepEqual(r.card.skills, ["Rust", "Figma"]);
  assert.equal(r.card.gradYear, 2028);
  assert.equal(r.card.isPublic, true);
});

test("profile: refuses http links, too many links or skills, bad years", () => {
  assert.equal(cleanCard({ links: ["http://example.com"] }).ok, false);
  assert.equal(cleanCard({ links: ["javascript:alert(1)"] }).ok, false);
  assert.equal(cleanCard({ links: ["https://a.com", "https://b.com", "https://c.com", "https://d.com"] }).ok, false);
  assert.equal(cleanCard({ skills: Array.from({ length: 9 }, (_, i) => `s${i}`) }).ok, false);
  assert.equal(cleanCard({ gradYear: 1999 }).ok, false);
  assert.equal(cleanCard({ gradYear: 2041 }).ok, false);
  assert.equal(cleanCard({ isPublic: "yes" }).ok && (cleanCard({ isPublic: "yes" }) as { card: { isPublic: boolean } }).card.isPublic, false);
  assert.ok(isEmptyCard(EMPTY_CARD));
});

test("profile: a signed save verifies only for the same wallet and the same text", () => {
  const w = wallet();
  const other = wallet();
  const r = cleanCard({ displayName: "Priya", bio: "Hi", isPublic: true });
  assert.ok(r.ok);
  if (!r.ok) return;
  const at = new Date().toISOString();
  const msg = cardSaveMessage(w.address, at, r.card);
  const sig = w.sign(msg);
  assert.equal(verifyWalletSignature(w.address, msg, sig), true);
  assert.equal(verifyWalletSignature(other.address, msg, sig), false, "another wallet");
  assert.equal(verifyWalletSignature(w.address, cardSaveMessage(w.address, at, { ...r.card, bio: "changed" }), sig), false, "changed text");
  assert.equal(verifyWalletSignature(w.address, msg, "not-a-signature"), false);
});

test("track record: terms, grouping by club and term, role counts", () => {
  assert.deepEqual(termOf("2026-11-17T18:00"), { label: "Fall 2026", order: 2026 * 3 + 2 });
  assert.equal(termOf("2026-02-01T10:00")?.label, "Spring 2026");
  assert.equal(termOf("2026-06-01T10:00")?.label, "Summer 2026");
  assert.equal(termOf("not a date"), null);
  const clubA = { id: "a", name: "A", issuer: "x", verified: true };
  const clubB = { id: "b", name: "B", issuer: "y", verified: true };
  const ev = (id: string, date: string, club = clubA, kind: "attendance" | "contribution" = "attendance", role: ProfileEvent["role"] = "Attendee"): ProfileEvent =>
    ({ id, name: id, date, mint: id, source: "chain", club, kind, role });
  const events = [ev("1", "2026-09-15T18:00"), ev("2", "2026-11-17T18:00"), ev("3", "2026-11-17T18:00", clubA, "contribution", "Mentor"), ev("4", "2026-02-01T18:00", clubB)];
  const groups = groupTrackRecord(events);
  assert.equal(groups[0].club.id, "a", "most recently active club first");
  assert.deepEqual(groups[0].terms.map((t) => t.label), ["Fall 2026"]);
  assert.equal(groups[1].terms[0].label, "Spring 2026");
  assert.deepEqual(roleCounts(groups[0].terms.flatMap((t) => t.events)), ["2 meetings", "mentored once"]);
});

test("tiers: 1 = Showed Up, 3 = Regular, 5 = Core Member", () => {
  assert.equal(getTier(0), null);
  assert.equal(getTier(1)?.name, "Showed Up");
  assert.equal(getTier(4)?.name, "Regular");
  assert.equal(getTier(9)?.name, "Core Member");
  assert.equal(getNextTier(2)?.name, "Regular");
  assert.equal(getNextTier(5), null);
});

test("chat: tokens work for their club only, and not once tampered with", () => {
  const w = wallet();
  const { token, expiresAt } = issueMemberToken(w.address, "abcd2345");
  assert.ok(Date.parse(expiresAt) > Date.now() + 6 * 86_400_000);
  assert.equal(readMemberToken(token, "abcd2345"), w.address);
  assert.equal(readMemberToken(token, "zzzz2345"), null, "other club");
  assert.equal(readMemberToken(token.slice(0, -2) + "xx", "abcd2345"), null, "tampered mac");
  const [, club, exp, mac] = token.split(".");
  assert.equal(readMemberToken([wallet().address, club, exp, mac].join("."), "abcd2345"), null, "swapped wallet");
  assert.equal(readMemberToken(`${w.address}.abcd2345.1.${mac}`, "abcd2345"), null, "expired / forged expiry");
  assert.equal(readMemberToken(null, "abcd2345"), null);
});

test("chat: sign-in message names the club and wallet; text is cleaned", () => {
  const msg = chatSignInMessage("abcd2345", "Wallet1", "2026-11-20T00:00:00.000Z");
  assert.match(msg, /Club: abcd2345/);
  assert.match(msg, /Wallet: Wallet1/);
  assert.equal(cleanText("  hi\u0007  there ", 50), "hi there");
  assert.equal(cleanText("a\n\n\n\nb", 50, true), "a\n\nb");
  assert.equal(cleanText("x".repeat(20), 5), "xxxxx");
  assert.equal(cleanText(42, 5), "");
});

test("check-in code: valid now, still valid just after it rotates, then expires", () => {
  const now = 1_800_000_000_000;
  const { code } = currentCode("ev1", now);
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal(isValidCode("ev1", code, now), true);
  assert.equal(isValidCode("ev2", code, now), false, "another event");
  assert.equal(isValidCode("ev1", code, now + CODE_WINDOW_MS), true, "one window later (screenshot grace)");
  assert.equal(isValidCode("ev1", code, now + 3 * CODE_WINDOW_MS), false, "long expired");
});
