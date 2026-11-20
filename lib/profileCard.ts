// A student's public profile card (name, headline, school, bio, links, skills), shown at the top
// of their track record once they switch it on. Shared by the browser and the server; nothing
// secret lives here. Stored in Supabase (db/07_profiles.sql), never on-chain.

export interface ProfileCard {
  displayName: string;
  headline: string;
  school: string;
  major: string;
  gradYear: number | null;
  bio: string;
  links: string[];
  skills: string[];
  /** Off until the student chooses to show it on their track record. */
  isPublic: boolean;
}

export const EMPTY_CARD: ProfileCard = { displayName: "", headline: "", school: "", major: "", gradYear: null, bio: "", links: [], skills: [], isPublic: false };

export const CARD_LIMITS = { displayName: 60, headline: 100, school: 80, major: 80, bio: 400, link: 200, links: 3, skill: 30, skills: 8 } as const;

/** Trims, collapses spaces (except in the bio) and drops control characters. */
function clean(raw: unknown, max: number, multiline = false): string {
  if (typeof raw !== "string") return "";
  let s = raw.replace(/\t/g, " ").replace(multiline ? /[\u0000-\u0008\u000b-\u001f\u007f]/g : /[\n\r]/g, multiline ? "" : " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  s = multiline ? s.replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}

/** Checks and tidies what the student typed. Returns a message for the first problem found. */
export function cleanCard(raw: unknown): { ok: true; card: ProfileCard } | { ok: false; message: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const links: string[] = [];
  for (const l of Array.isArray(r.links) ? r.links : []) {
    const s = clean(l, CARD_LIMITS.link);
    if (!s) continue;
    let url: URL;
    try { url = new URL(s); } catch { return { ok: false, message: `“${s}” isn’t a full web address. Start it with https://` }; }
    if (url.protocol !== "https:") return { ok: false, message: "Links must start with https://" };
    links.push(url.toString());
  }
  if (links.length > CARD_LIMITS.links) return { ok: false, message: `Up to ${CARD_LIMITS.links} links.` };
  const skills = [...new Set((Array.isArray(r.skills) ? r.skills : []).map((s) => clean(s, CARD_LIMITS.skill)).filter(Boolean))];
  if (skills.length > CARD_LIMITS.skills) return { ok: false, message: `Up to ${CARD_LIMITS.skills} skills.` };
  let gradYear: number | null = null;
  if (r.gradYear !== null && r.gradYear !== undefined && r.gradYear !== "") {
    const y = Number(r.gradYear);
    if (!Number.isInteger(y) || y < 2000 || y > 2040) return { ok: false, message: "Pick a graduation year between 2000 and 2040." };
    gradYear = y;
  }
  return {
    ok: true,
    card: {
      displayName: clean(r.displayName, CARD_LIMITS.displayName),
      headline: clean(r.headline, CARD_LIMITS.headline),
      school: clean(r.school, CARD_LIMITS.school),
      major: clean(r.major, CARD_LIMITS.major),
      gradYear,
      bio: clean(r.bio, CARD_LIMITS.bio, true),
      links,
      skills,
      isPublic: r.isPublic === true,
    },
  };
}

/**
 * The exact text the wallet signs to save a profile. It contains the profile itself, so the
 * wallet shows the student what they're publishing, and the server rebuilds it to check.
 */
export function cardSaveMessage(wallet: string, signedAt: string, card: ProfileCard): string {
  return `ShowedUp profile update\nWallet: ${wallet}\nTime: ${signedAt}\nShow on track record: ${card.isPublic ? "yes" : "no"}\n${JSON.stringify({
    displayName: card.displayName, headline: card.headline, school: card.school, major: card.major,
    gradYear: card.gradYear, bio: card.bio, links: card.links, skills: card.skills,
  })}`;
}

/** The text the wallet signs to load its own profile while it's still hidden. */
export function cardReadMessage(wallet: string, signedAt: string): string {
  return `ShowedUp profile read\nWallet: ${wallet}\nTime: ${signedAt}`;
}

/** True when a card has nothing worth showing. */
export function isEmptyCard(c: ProfileCard): boolean {
  return !c.displayName && !c.headline && !c.school && !c.major && !c.gradYear && !c.bio && c.links.length === 0 && c.skills.length === 0;
}
