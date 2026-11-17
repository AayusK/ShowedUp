"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "./Icon";
import { checkSession, readSession, saveSession, type OrganizerSession } from "@/lib/organizerSession";
import { LEGACY_CLUB_ID, LEGACY_CLUB_NAME, type ClubInfo } from "@/lib/clubs";

/** What the page learns once an officer is signed in. */
export interface Unlocked {
  session: OrganizerSession;
  club: ClubInfo | null;
  admin: boolean;
}

export function OrganizerAccessModal({
  initialError = "",
  fixedClub,
  onClose,
  onUnlocked,
}: {
  initialError?: string;
  /** Set on an event's page: the event belongs to this club, so there is nothing to choose. */
  fixedClub?: { id: string; name: string };
  onClose: () => void;
  onUnlocked: (unlocked: Unlocked) => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  // Which club the officer is signing in to. The list is public (names and issuer addresses).
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>(fixedClub ? [fixedClub] : [{ id: LEGACY_CLUB_ID, name: LEGACY_CLUB_NAME }]);
  const [clubId, setClubId] = useState(fixedClub?.id ?? LEGACY_CLUB_ID);

  useEffect(() => {
    if (fixedClub) return;
    let cancelled = false;
    fetch("/api/clubs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { clubs?: ClubInfo[] } | null) => {
        if (cancelled || !d?.clubs?.length) return;
        setClubs(d.clubs);
        const last = readSession()?.clubId;
        if (last && d.clubs.some((c) => c.id === last)) setClubId(last);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [fixedClub]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!input) { setError("Enter your club’s passcode."); return; }
    setBusy(true);
    setError("");
    try {
      const session = { clubId, password: input };
      const check = await checkSession(session);
      if (check.ok) {
        saveSession(session);
        onUnlocked({ session, club: check.club ?? null, admin: !!check.admin });
      } else {
        setError("That passcode didn’t work for this club. Try again.");
      }
    } catch {
      setError("Couldn’t reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-overlay" onClick={()=>!busy && onClose()}><form role="dialog" aria-modal="true" aria-label="Organizer access" className="modal" onClick={e=>e.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button><div className="large-symbol"><Icon name="shield" size={28}/></div><h2>A space for organizers.</h2><p>Your community’s next gathering starts here.</p>{clubs.length > 1 && <label className="field">Your club<select value={clubId} disabled={busy} onChange={e=>setClubId(e.target.value)}>{clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}{fixedClub && <p className="modal-club">Signing in to <strong>{fixedClub.name}</strong></p>}<label className="field">Club passcode<input type="password" placeholder="Enter your club’s passcode" autoComplete="off" autoFocus value={input} onChange={e=>setInput(e.target.value)}/></label><button type="submit" className="button primary full" disabled={busy}>{busy ? "Checking…" : "Enter workspace"} <Icon name="arrow" size={16}/></button>{error && <p className="form-error" role="alert">{error}</p>}<small>Ask your club lead for the passcode.</small></form></div>;
}
