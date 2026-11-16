"use client";

import { useState, type FormEvent } from "react";
import { Icon } from "./Icon";
import { checkPassword, savePassword } from "@/lib/organizerSession";

export function OrganizerAccessModal({
  initialError = "",
  onClose,
  onUnlocked,
}: {
  initialError?: string;
  onClose: () => void;
  onUnlocked: (password: string) => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!input) { setError("Enter the organizer password."); return; }
    setBusy(true);
    setError("");
    try {
      if (await checkPassword(input)) {
        savePassword(input);
        onUnlocked(input);
      } else {
        setError("That password didn’t work. Try again.");
      }
    } catch {
      setError("Couldn’t reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-overlay" onClick={()=>!busy && onClose()}><form role="dialog" aria-modal="true" aria-label="Organizer access" className="modal" onClick={e=>e.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button><div className="large-symbol"><Icon name="shield" size={28}/></div><h2>A space for organizers.</h2><p>Your community’s next gathering starts here.</p><label className="field">Organizer password<input type="password" placeholder="Enter your shared password" autoComplete="off" autoFocus value={input} onChange={e=>setInput(e.target.value)}/></label><button type="submit" className="button primary full" disabled={busy}>{busy ? "Checking…" : "Enter workspace"} <Icon name="arrow" size={16}/></button>{error && <p className="form-error" role="alert">{error}</p>}<small>Ask your club lead for the shared password.</small></form></div>;
}
