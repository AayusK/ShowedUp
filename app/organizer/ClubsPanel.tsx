"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { explorerLink } from "@/lib/solana";
import { CLUB_NAME_MAX, LEGACY_CLUB_ID, PASSCODE_MIN, isValidPasscode, type ClubInfo } from "@/lib/clubs";

/**
 * The registry admin's corner of the organizer page: the list of clubs, who is verified, and a
 * form to add a club. Shown only when signed in to the default club, whose passcode is also the
 * admin password. Every change is checked again on the server.
 */
export function ClubsPanel({ adminPassword }: { adminPassword: string }) {
  const [clubs, setClubs] = useState<ClubInfo[] | null>(null);
  const [modal, setModal] = useState(false);
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [verified, setVerified] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rowBusy, setRowBusy] = useState("");
  const [rowError, setRowError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/clubs", { cache: "no-store" });
      const data = (await res.json()) as { clubs?: ClubInfo[] };
      setClubs(res.ok && Array.isArray(data.clubs) ? data.clubs : []);
    } catch {
      setClubs([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setModal(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Give the club a name."); return; }
    if (passcode.length < PASSCODE_MIN) { setError(`Choose a passcode with at least ${PASSCODE_MIN} characters.`); return; }
    if (!isValidPasscode(passcode)) { setError("Use plain letters, numbers and symbols, with no space at the start or end."); return; }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/clubs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-organizer-password": adminPassword },
        body: JSON.stringify({ name, passcode, verified }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setModal(false);
        setName("");
        setPasscode("");
        await load();
        return;
      }
      switch (data.error) {
        case "unauthorized": setError("Only the registry admin can add clubs. Lock and sign in again."); break;
        case "name_taken": setError("A club with that name already exists."); break;
        case "club_key_not_configured": setError("Club wallets aren’t set up. Add CLUB_KEY_SECRET to the server’s settings and restart it."); break;
        case "invalid_input": setError(data.message ?? "Check the club details and try again."); break;
        default: setError("Couldn’t save the club. Check that the clubs table exists, then try again.");
      }
    } catch {
      setError("Couldn’t reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function setClubVerified(club: ClubInfo, next: boolean) {
    setRowBusy(club.id);
    setRowError("");
    try {
      const res = await fetch(`/api/clubs/${club.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-organizer-password": adminPassword },
        body: JSON.stringify({ verified: next }),
      });
      if (!res.ok) setRowError(`Couldn’t update ${club.name}. Try again.`);
      await load();
    } catch {
      setRowError("Couldn’t reach the server. Try again.");
    } finally {
      setRowBusy("");
    }
  }

  return <>
    <div className="section-heading clubs-heading"><div><span className="eyebrow">REGISTRY ADMIN</span><h2>Clubs</h2></div><button className="button secondary" onClick={() => { setError(""); setModal(true); }}><Icon name="plus" size={17}/> Add a club</button></div>
    <div className="panel event-list">
      {clubs === null && <div className="event-row"><div className="event-info"><h3>Loading clubs…</h3></div></div>}
      {clubs?.length === 0 && <div className="event-row"><div className="event-info"><h3>Couldn’t load clubs.</h3><p>Refresh the page to try again.</p></div></div>}
      {clubs?.map((c) => <div className="event-row club-row" key={c.id}><span className="history-check"><Icon name={c.verified ? "shield" : "people"} size={17}/></span><div className="event-info"><h3>{c.name}</h3><p>{c.verified ? "Verified issuer · badges from this club count" : "Not verified · badges from this club aren’t counted yet"}</p></div>{c.issuer && <a className="pill-link" href={explorerLink(c.issuer)} target="_blank" rel="noreferrer">Issuer wallet <Icon name="external" size={14}/></a>}{c.id !== LEGACY_CLUB_ID && <button className="button secondary" disabled={rowBusy === c.id} onClick={() => setClubVerified(c, !c.verified)}>{rowBusy === c.id ? "Saving…" : c.verified ? "Remove verification" : "Verify"}</button>}</div>)}
    </div>
    {rowError && <p className="form-error" role="alert">{rowError}</p>}
    {modal && <div className="modal-overlay" onClick={() => !busy && setModal(false)}><form role="dialog" aria-modal="true" aria-label="Add a club" className="modal" onClick={e => e.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" aria-label="Close" disabled={busy} onClick={() => setModal(false)}>×</button><span className="eyebrow">GROW THE REGISTRY</span><h2>Add a club.</h2><p>It gets its own wallet on Solana for issuing badges.</p><label className="field">Club name<input value={name} maxLength={CLUB_NAME_MAX} placeholder="e.g. Hack Club" onChange={e => setName(e.target.value)}/></label><label className="field">Club passcode<input type="password" autoComplete="new-password" value={passcode} maxLength={100} placeholder={`At least ${PASSCODE_MIN} characters`} onChange={e => setPasscode(e.target.value)}/></label><label className="check-field"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)}/> Verified: this is a real club, and its badges count</label><button type="submit" className="button primary full" disabled={busy}>{busy ? "Adding club…" : "Add club"} <Icon name="arrow" size={16}/></button>{error && <p className="form-error" role="alert">{error}</p>}<small>Share the passcode with that club’s officers. It can’t be shown again: only a scrambled copy is stored.</small></form></div>}
  </>;
}
