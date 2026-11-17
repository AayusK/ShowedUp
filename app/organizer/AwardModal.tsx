"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { explorerLink } from "@/lib/solana";
import { clubHeaders, type OrganizerSession } from "@/lib/organizerSession";
import { CONTRIBUTION_ROLES, type Role } from "@/lib/badges";

interface Member {
  wallet: string;
  name: string;
}

/** A contribution badge that already exists, when the officer is adding more recipients to it. */
export interface AwardTarget {
  id: string;
  name: string;
  role?: string;
}

type Outcome = "awarded" | "already" | "failed";
interface Result {
  wallet: string;
  label: string;
  outcome: Outcome;
  signature?: string;
  note?: string;
}

const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "Award contribution": an officer records what someone did. Title, role and date create the
 * badge (one token on Solana, issued from the club's wallet); every recipient then gets one.
 * No QR code. Recipients are picked from people who have checked in to this club's events, or
 * pasted as wallet addresses. The server locks each (badge, wallet) pair, so a double click
 * can't award twice.
 */
export function AwardModal({ session, existing, onClose, onChanged }: {
  session: OrganizerSession;
  existing?: AwardTarget;
  onClose: () => void;
  /** Called whenever a badge was created or awarded, so the page can refresh its list. */
  onChanged: () => void;
}) {
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<Role>("Mentor");
  const [date, setDate] = useState(todayLocal);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [membersError, setMembersError] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  // Once the badge exists we keep awarding that same badge, even if the officer submits again.
  const [badge, setBadge] = useState<AwardTarget | null>(existing ?? null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clubs/${session.clubId}/members`, { headers: clubHeaders(session), cache: "no-store" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.ok) { setMembers(((await r.json()) as { members: Member[] }).members ?? []); return; }
        setMembers([]);
        setMembersError(r.status === 401 ? "Your organizer session expired. Close this and sign in again." : "Couldn’t load the people who’ve checked in. You can still paste wallet addresses.");
      })
      .catch(() => { if (!cancelled) { setMembers([]); setMembersError("Couldn’t reach the server. You can still paste wallet addresses."); } });
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (members ?? []).filter((m) => !q || m.name.toLowerCase().includes(q) || m.wallet.toLowerCase().includes(q));
  }, [members, search]);

  function toggle(wallet: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(wallet)) next.delete(wallet); else next.add(wallet);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const pastedList = pasted.split(/[\s,;]+/).filter(Boolean);
    const bad = pastedList.find((w) => !ADDRESS_RE.test(w));
    if (bad) { setError(`“${bad.slice(0, 16)}${bad.length > 16 ? "…" : ""}” isn’t a wallet address.`); return; }
    const recipients = [...new Set([...picked, ...pastedList])];
    if (!badge && !title.trim()) { setError("Give the contribution a title."); return; }
    if (!badge && !date) { setError("Pick a date."); return; }
    if (recipients.length === 0) { setError("Pick at least one person, or paste a wallet address."); return; }
    if (recipients.length > 50) { setError("Award up to 50 people at a time."); return; }
    setError("");

    try {
      // 1. Create the badge (once).
      let target = badge;
      if (!target) {
        setBusy("Creating the badge on Solana…");
        const res = await fetch("/api/events", {
          method: "POST",
          headers: { "content-type": "application/json", ...clubHeaders(session) },
          // Contribution badges record a day, not a time of day; noon is a placeholder.
          body: JSON.stringify({ name: title, date: `${date}T12:00`, kind: "contribution", role }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            data.error === "unauthorized" ? "Your organizer session expired. Close this and sign in again."
            : data.error === "organizer_unfunded" ? "The organizer wallet needs devnet SOL before it can create badges."
            : data.error === "club_key_not_configured" ? "This club’s wallet isn’t set up. Check CLUB_KEY_SECRET in the server’s settings."
            : data.error === "invalid_input" ? (data.message ?? "Check the details and try again.")
            : data.error === "schema_not_ready" ? "The database isn’t ready for contribution badges yet. Run db/02_role_badges.sql in Supabase, then try again."
            : data.error === "save_failed" ? "The badge was created on Solana but couldn’t be saved. Don’t try again yet: ask whoever runs the app to check the database."
            : "Couldn’t create the badge on Solana devnet. Wait a moment and try again.");
          return;
        }
        target = { id: data.event.id, name: data.event.name, role: data.event.role };
        setBadge(target);
        onChanged();
      }

      // 2. Give it to each person, one at a time.
      const names = new Map((members ?? []).map((m) => [m.wallet, m.name]));
      const done: Result[] = [];
      for (let i = 0; i < recipients.length; i++) {
        const wallet = recipients[i];
        const label = names.get(wallet) ?? short(wallet);
        setBusy(`Awarding ${i + 1} of ${recipients.length}…`);
        try {
          const res = await fetch(`/api/events/${target.id}/award`, {
            method: "POST",
            headers: { "content-type": "application/json", ...clubHeaders(session) },
            body: JSON.stringify({ wallet }),
          });
          const data = await res.json().catch(() => ({}));
          if (data.status === "awarded") done.push({ wallet, label, outcome: "awarded", signature: data.signature });
          else if (data.status === "already_awarded") done.push({ wallet, label, outcome: "already" });
          else done.push({ wallet, label, outcome: "failed", note:
            data.error === "invalid_wallet" ? "Not a valid wallet address"
            : data.error === "in_progress" ? "Already going through, check again in a moment"
            : data.error === "organizer_unfunded" ? "The organizer wallet is out of devnet SOL"
            : data.error === "unauthorized" ? "Session expired, sign in again"
            : "Couldn’t reach Solana devnet" });
        } catch {
          done.push({ wallet, label, outcome: "failed", note: "Couldn’t reach the server" });
        }
        setResults([...done]);
      }
      // Keep anyone who didn't get the badge selected, so the officer can simply try again.
      const failedWallets = new Set(done.filter((r) => r.outcome === "failed").map((r) => r.wallet));
      setPicked(new Set([...picked].filter((w) => failedWallets.has(w))));
      setPasted(pastedList.filter((w) => failedWallets.has(w)).join("\n"));
      onChanged();
    } catch {
      setError("Couldn’t reach the server. Try again.");
    } finally {
      setBusy("");
    }
  }

  const awarded = results?.filter((r) => r.outcome !== "failed").length ?? 0;
  const failed = results?.filter((r) => r.outcome === "failed") ?? [];

  return <div className="modal-overlay" onClick={() => !busy && onClose()}><form role="dialog" aria-modal="true" aria-label="Award contribution" className="modal award-modal" onClick={e => e.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" aria-label="Close" disabled={!!busy} onClick={onClose}>×</button><span className="eyebrow">MORE THAN SHOWING UP</span><h2>{badge ? `Award “${badge.name}”` : "Record a contribution."}</h2><p>{badge ? `Each person gets one ${badge.role ?? "contribution"} badge from your club.` : "Say what someone did for your club. It goes on their track record."}</p>
    {!badge && <><label className="field">Title<input value={title} maxLength={80} placeholder="e.g. Intro to Solana Workshop" onChange={e => setTitle(e.target.value)} disabled={!!busy}/><small>Describe the contribution, not the person. This title is written on Solana, which is public and permanent, so never put anyone’s name in it.</small></label><div className="form-columns"><label className="field">Role<select value={role} onChange={e => setRole(e.target.value as Role)} disabled={!!busy}>{CONTRIBUTION_ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></label><label className="field">Date<input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!!busy}/></label></div></>}
    <div className="field award-pick"><span>Who earned it</span><input type="search" value={search} placeholder="Search people who’ve checked in" onChange={e => setSearch(e.target.value)} aria-label="Search people who’ve checked in"/>
      <div className="award-list" role="group" aria-label="People who’ve checked in">{members === null ? <p>Loading people…</p> : membersError ? <p>{membersError}</p> : members.length === 0 ? <p>Nobody has checked in to this club’s events yet. Paste a wallet address below.</p> : shown.length === 0 ? <p>No one matches that search.</p> : shown.map(m => <label key={m.wallet} className="award-person"><input type="checkbox" checked={picked.has(m.wallet)} disabled={!!busy} onChange={() => toggle(m.wallet)}/><span>{m.name}</span><small>{short(m.wallet)}</small></label>)}</div>
      {picked.size > 0 && <small>{picked.size} selected</small>}</div>
    <label className="field">Or paste wallet addresses<textarea value={pasted} rows={2} placeholder="One per line" onChange={e => setPasted(e.target.value)} disabled={!!busy}/></label>
    <button type="submit" className="button primary full" disabled={!!busy}>{busy || (badge ? "Award badge" : "Create badge and award")} <Icon name="arrow" size={16}/></button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {results && results.length > 0 && <div className="award-results" aria-live="polite"><strong>{awarded} of {results.length} awarded{failed.length > 0 ? ` · ${failed.length} didn’t go through` : ""}</strong><ul>{results.map(r => <li key={r.wallet} className={r.outcome === "failed" ? "award-failed" : ""}><span>{r.label}</span>{r.outcome === "awarded" && r.signature ? <a href={explorerLink(r.signature, "tx")} target="_blank" rel="noreferrer">On Solana <Icon name="external" size={12}/></a> : <small>{r.outcome === "already" ? "Already has it" : r.outcome === "failed" ? r.note : "Awarded"}</small>}</li>)}</ul></div>}
    <small>Creates one nontransferable Token-2022 token on Solana devnet for the badge, then one transaction per person. The organizer wallet pays the fees.</small></form></div>;
}
