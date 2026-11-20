"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { explorerLink } from "@/lib/solana";
import { clubHeaders, type OrganizerSession } from "@/lib/organizerSession";
import { CONTRIBUTION_ROLES, type Role } from "@/lib/badges";
import { shortAddress } from "@/lib/profileClient";

interface Member { wallet: string; name: string }
export interface AwardTarget { id: string; name: string; role?: string }
interface Result { wallet: string; label: string; note: string; signature?: string; failed?: boolean }

const errors: Record<string, string> = {
  not_checked_in: "This person has not checked in to the selected event.",
  different_summary: "A different description was already approved for this role at this event.",
  invalid_contribution: "Choose a role and describe the contribution in 1–600 characters.",
  invalid_wallet: "Invalid wallet address.",
  in_progress: "Confirmation is pending. Retry to check the same transaction.",
  organizer_unfunded: "The organizer wallet needs devnet SOL.",
  club_key_not_configured: "The club issuer key needs to be configured.",
  unauthorized: "Your organizer session expired. Sign in again.",
};

/** New receipts belong to an attendance event. Existing token badges keep their award path. */
export function AwardModal({ session, existing, events = [], onClose, onChanged }: {
  session: OrganizerSession; existing?: AwardTarget; events?: AwardTarget[];
  onClose: () => void; onChanged: () => void;
}) {
  const [eventId, setEventId] = useState(existing?.id ?? events[0]?.id ?? "");
  const [role, setRole] = useState<Role>("Mentor");
  const [summary, setSummary] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[]>([]);

  const legacyBadge = !!existing;
  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    const url = legacyBadge ? `/api/clubs/${session.clubId}/members` : `/api/events/${eventId}/attendees`;
    setLoading(true);
    fetch(url, { headers: clubHeaders(session), cache: "no-store", signal: controller.signal })
      .then(async r => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (!controller.signal.aborted) setMembers((legacyBadge ? data.members : data.attendees) ?? []);
      })
      .catch(() => { if (!controller.signal.aborted) setError("Couldn’t load the roster. Close and reopen to retry."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session, eventId, legacyBadge]);

  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy, onClose]);

  function selectEvent(id: string) {
    setEventId(id); setPicked([]); setMembers([]); setResults([]); setError(""); setSearch("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !eventId) return;
    const pastedWallets = existing ? pasted.split(/[\s,;]+/).filter(Boolean) : [];
    const wallets = [...new Set([...picked, ...pastedWallets])];
    if (!wallets.length || wallets.length > 50) { setError("Select 1 to 50 recipients."); return; }
    if (!existing && !summary.trim()) { setError("Describe what the recipients did."); return; }
    const done: Result[] = [];
    setError(""); setResults([]);
    try {
      for (const [index, wallet] of wallets.entries()) {
        setBusy(`Confirming ${index + 1} of ${wallets.length}…`);
        const label = members.find(m => m.wallet === wallet)?.name ?? shortAddress(wallet);
        try {
          const response = await fetch(`/api/events/${eventId}/award`, {
            method: "POST", headers: { "content-type": "application/json", ...clubHeaders(session) },
            body: JSON.stringify(existing ? { wallet } : { wallet, role, summary: summary.trim() }),
          });
          const data = await response.json();
          if (response.ok && (data.status === "awarded" || data.status === "already_awarded")) {
            done.push({ wallet, label, note: data.status === "awarded" ? "Confirmed" : "Already confirmed", signature: data.signature });
          } else {
            done.push({ wallet, label, failed: true, note: errors[data.error] ?? "Couldn’t finish confirmation. Retry to check its status." });
          }
        } catch {
          done.push({ wallet, label, failed: true, note: "Connection interrupted. Retry to check its status." });
        }
        setResults([...done]);
      }
      const failed = done.filter(r => r.failed).map(r => r.wallet);
      setPicked(picked.filter(w => failed.includes(w)));
      setPasted(pastedWallets.filter(w => failed.includes(w)).join("\n"));
      onChanged();
    } finally { setBusy(""); }
  }

  const query = search.trim().toLowerCase();
  const shown = members.filter(m => m.name.toLowerCase().includes(query) || m.wallet.toLowerCase().includes(query));
  return <div className="modal-overlay" onClick={() => !busy && onClose()}>
    <form role="dialog" aria-modal="true" aria-label="Award contribution" className="modal award-modal" onSubmit={submit} onClick={e => e.stopPropagation()}>
      <button type="button" className="modal-close" aria-label="Close" disabled={!!busy} onClick={onClose}>×</button>
      <h2>{existing ? `Award “${existing.name}”` : "Confirm a contribution"}</h2>
      {!existing && <>
        <label className="field">Event<select value={eventId} onChange={e => selectEvent(e.target.value)} disabled={!!busy || !events.length}>
          {!events.length && <option value="">Create a check-in event first</option>}
          {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select></label>
        <label className="field">Role<select value={role} onChange={e => setRole(e.target.value as Role)} disabled={!!busy}>
          {CONTRIBUTION_ROLES.map(r => <option key={r}>{r}</option>)}
        </select></label>
        <label className="field">What did they do?<textarea value={summary} rows={2} maxLength={600} required
          placeholder="Mentored a team during the workshop" disabled={!!busy} onChange={e => setSummary(e.target.value)} />
          <small>Each selected student receives a signed copy of this description.</small></label>
      </>}
      <div className="field award-pick"><span>{existing ? "Recipients" : "Checked-in attendees"}</span>
        <input type="search" value={search} placeholder="Find an attendee" aria-label="Find an attendee" onChange={e => setSearch(e.target.value)}/>
        <div className="award-list">{loading ? <p>Loading roster…</p> : !shown.length ? <p>{members.length ? "No matching attendees." : "No attendees to select."}</p>
          : shown.map(m => <label key={m.wallet} className="award-person">
            <input type="checkbox" checked={picked.includes(m.wallet)} disabled={!!busy}
              onChange={e => setPicked(e.target.checked ? [...picked, m.wallet] : picked.filter(w => w !== m.wallet))}/>
            <span>{m.name}</span><small>{shortAddress(m.wallet)}</small></label>)}</div>
      </div>
      {existing && <label className="field">Or paste wallet addresses<textarea value={pasted} rows={2} disabled={!!busy} onChange={e => setPasted(e.target.value)}/></label>}
      <button className="button primary full" disabled={!!busy || !eventId}>{busy || (existing ? "Award badge" : "Confirm and issue receipts")}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
      {results.length > 0 && <ul className="award-results" aria-live="polite">{results.map(r => <li key={r.wallet}>
        <strong>{r.label}</strong> · {r.note} {r.signature && <a href={explorerLink(r.signature, "tx")} target="_blank" rel="noreferrer">Transaction <Icon name="external" size={12}/></a>}
      </li>)}</ul>}
    </form>
  </div>;
}
