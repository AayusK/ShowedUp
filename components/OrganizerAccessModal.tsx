"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "./Icon";
import { checkSession, readSession, saveSession, type OrganizerSession } from "@/lib/organizerSession";
import { CLUB_NAME_MAX, LEGACY_CLUB_ID, LEGACY_CLUB_NAME, PASSCODE_MIN, cleanClubName, isValidPasscode, type ClubInfo } from "@/lib/clubs";

/** What the page learns once an officer is signed in. */
export interface Unlocked {
  session: OrganizerSession;
  club: ClubInfo | null;
  admin: boolean;
}

export function OrganizerAccessModal({
  initialError = "",
  startCreating = false,
  fixedClub,
  onClose,
  onUnlocked,
}: {
  initialError?: string;
  /** Open on the "Create a club" form instead of sign-in. */
  startCreating?: boolean;
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

  // "Create a club": anyone can sign a club up. It starts unverified; events and badges unlock
  // once the registry admin verifies it.
  const [mode, setMode] = useState<"signin" | "create">(startCreating && !fixedClub ? "create" : "signin");
  const [newName, setNewName] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");

  async function create(e: FormEvent) {
    e.preventDefault();
    const name = cleanClubName(newName);
    if (!name) { setError("Give your club a name."); return; }
    if (newPass.length < PASSCODE_MIN) { setError(`Choose a passcode with at least ${PASSCODE_MIN} characters.`); return; }
    if (!isValidPasscode(newPass)) { setError("Use plain letters, numbers and symbols, with no space at the start or end."); return; }
    if (newPass !== newPass2) { setError("The two passcodes don’t match."); return; }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/clubs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, passcode: newPass }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error === "name_taken" ? "A club with that name already exists. Sign in instead, or pick another name."
          : data.error === "too_many_pending" ? "Lots of clubs are waiting for verification right now. Try again later."
          : data.error === "club_key_not_configured" ? "Club wallets aren’t set up on this server yet (CLUB_KEY_SECRET)."
          : data.error === "invalid_input" ? (data.message ?? "Check the club name and passcode.")
          : "Couldn’t create the club. Try again.");
        return;
      }
      const session = { clubId: data.club.id as string, password: newPass };
      saveSession(session);
      onUnlocked({ session, club: data.club as ClubInfo, admin: false });
    } catch {
      setError("Couldn’t reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

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

  if (mode === "create") {
    return <div className="modal-overlay" onClick={()=>!busy && onClose()}><form role="dialog" aria-modal="true" aria-label="Create a club" className="modal" onClick={e=>e.stopPropagation()} onSubmit={create}><button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button><div className="large-symbol"><Icon name="plus" size={28}/></div><h2>Create a club.</h2><p>It gets its own wallet on Solana for issuing badges. Events and badges unlock once ShowedUp verifies your club.</p><label className="field">Club name<input value={newName} maxLength={CLUB_NAME_MAX} placeholder="e.g. UBC Hack Club" autoFocus onChange={e=>setNewName(e.target.value)}/></label><label className="field">Club passcode<input type="password" autoComplete="new-password" value={newPass} maxLength={100} placeholder={`At least ${PASSCODE_MIN} characters`} onChange={e=>setNewPass(e.target.value)}/></label><label className="field">Repeat the passcode<input type="password" autoComplete="new-password" value={newPass2} maxLength={100} onChange={e=>setNewPass2(e.target.value)}/></label><button type="submit" className="button primary full" disabled={busy}>{busy ? "Creating your club…" : "Create club"} <Icon name="arrow" size={16}/></button>{error && <p className="form-error" role="alert">{error}</p>}<small>Share the passcode only with your club’s officers. It can’t be shown again. <button type="button" className="text-link" onClick={()=>{ setMode("signin"); setError(""); }}>Back to sign in</button></small></form></div>;
  }

  return <div className="modal-overlay" onClick={()=>!busy && onClose()}><form role="dialog" aria-modal="true" aria-label="Organizer access" className="modal" onClick={e=>e.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button><div className="large-symbol"><Icon name="shield" size={28}/></div><h2>A space for organizers.</h2><p>Your community’s next gathering starts here.</p>{clubs.length > 1 && <label className="field">Your club<select value={clubId} disabled={busy} onChange={e=>setClubId(e.target.value)}>{clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}{fixedClub && <p className="modal-club">Signing in to <strong>{fixedClub.name}</strong></p>}<label className="field">Club passcode<input type="password" placeholder="Enter your club’s passcode" autoComplete="off" autoFocus value={input} onChange={e=>setInput(e.target.value)}/></label><button type="submit" className="button primary full" disabled={busy}>{busy ? "Checking…" : "Enter workspace"} <Icon name="arrow" size={16}/></button>{error && <p className="form-error" role="alert">{error}</p>}<small>Ask your club lead for the passcode.{!fixedClub && <> New here? <button type="button" className="text-link" onClick={()=>{ setMode("create"); setError(""); }}>Create a club</button></>}</small></form></div>;
}
