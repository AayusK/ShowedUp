// Client-side helpers for an officer's session: which club they signed in to, and its passcode.
// It's kept in sessionStorage, so it lasts until the browser tab is closed.
import { LEGACY_CLUB_ID, type ClubInfo } from "@/lib/clubs";

const PASSWORD_KEY = "showedup-organizer-password";
const CLUB_KEY = "showedup-organizer-club";

export interface OrganizerSession {
  clubId: string;
  password: string;
}

export function readSession(): OrganizerSession | null {
  try {
    const password = sessionStorage.getItem(PASSWORD_KEY);
    if (!password) return null;
    // A session saved before clubs existed has no club: it belongs to the default club.
    return { clubId: sessionStorage.getItem(CLUB_KEY) || LEGACY_CLUB_ID, password };
  } catch { return null; }
}

export function saveSession(session: OrganizerSession | null) {
  try {
    if (session) {
      sessionStorage.setItem(PASSWORD_KEY, session.password);
      sessionStorage.setItem(CLUB_KEY, session.clubId);
    } else {
      sessionStorage.removeItem(PASSWORD_KEY);
      sessionStorage.removeItem(CLUB_KEY);
    }
  } catch {}
}

/** The two headers every club action sends: which club, and its passcode. */
export function clubHeaders(session: OrganizerSession): Record<string, string> {
  return { "x-club-id": session.clubId, "x-organizer-password": session.password };
}

export interface SessionCheck {
  ok: boolean;
  club?: ClubInfo;
  /** True for the default club, whose passcode is also the registry admin password. */
  admin?: boolean;
}

export async function checkSession(session: OrganizerSession): Promise<SessionCheck> {
  // A passcode with characters an HTTP header can't carry is simply a wrong passcode.
  if (/[^\x20-\x7e\xa0-\xff]/.test(session.password)) return { ok: false };
  const res = await fetch("/api/organizer/verify", { method: "POST", headers: clubHeaders(session) });
  if (res.status === 401) return { ok: false };
  if (!res.ok) throw new Error("server_error");
  const data = (await res.json()) as { club?: ClubInfo; admin?: boolean };
  return { ok: true, club: data.club, admin: !!data.admin };
}
