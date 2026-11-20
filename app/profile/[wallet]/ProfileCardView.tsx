"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { Icon } from "@/components/Icon";
import { useEmbeddedWallet } from "@/lib/embeddedWallet";
import { CARD_LIMITS, EMPTY_CARD, cardReadMessage, cardSaveMessage, cleanCard, isEmptyCard, type ProfileCard } from "@/lib/profileCard";

const isLinkedIn = (url: string) => /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\//i.test(url);
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/** Initials for the avatar: up to two letters from the name, or "?" without one. */
function initials(name: string): string {
  const parts = name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  return parts.slice(0, 2).map((w) => Array.from(w)[0]!.toUpperCase()).join("") || "?";
}

/**
 * The Handshake-style header on a track record: cover band, initials avatar, name, headline,
 * school line, LinkedIn and other links, skills, and an About card. Shown only when the student
 * switched their profile on. On your own record you also get "Edit profile".
 */
export function ProfileCardHeader({ card, isMine, onEdit, summary }: { card: ProfileCard | null; isMine: boolean; onEdit: () => void; summary: ReactNode }) {
  const filled = !!card && !isEmptyCard(card);
  const c = filled ? card! : null;
  const linkedin = c?.links.find(isLinkedIn);
  const others = c ? c.links.filter((l) => l !== linkedin) : [];
  const education = c ? [c.school, c.major, c.gradYear ? `Class of ${c.gradYear}` : ""].filter(Boolean).join(" · ") : "";
  return <section className="pc">
    <div className="pc-cover" aria-hidden="true"/>
    <div className="pc-body">
      <span className={`pc-avatar${c?.displayName ? "" : " is-blank"}`} aria-hidden="true">{c?.displayName ? initials(c.displayName) : <Icon name="shield" size={30}/>}</span>
      <div className="pc-actions">
        {linkedin && <a className="pc-linkedin" href={linkedin} target="_blank" rel="noreferrer"><span aria-hidden="true">in</span> LinkedIn</a>}
        {isMine && <button type="button" className="button secondary" onClick={onEdit}>{filled ? "Edit profile" : "Add your profile"}</button>}
      </div>
      <h1 className="pc-name">{c?.displayName || (isMine ? "Your track record" : "Track record")}</h1>
      {c?.headline && <p className="pc-headline">{c.headline}</p>}
      {education && <p className="pc-edu"><Icon name="calendar" size={14}/> {education}</p>}
      {others.length > 0 && <p className="pc-links">{others.map((l) => <a key={l} href={l} target="_blank" rel="noreferrer">{host(l)} <Icon name="external" size={12}/></a>)}</p>}
      {c && c.skills.length > 0 && <ul className="pc-skills">{c.skills.map((s) => <li key={s}>{s}</li>)}</ul>}
      {isMine && !filled && <p className="pc-prompt">Add your name, school, a short bio, LinkedIn and skills. Hidden until you switch it on.</p>}
      {isMine && c && !c.isPublic && <p className="pc-hidden-note"><Icon name="shield" size={14}/> Only you can see your profile. Turn on “Show on my track record” to share it.</p>}
      {summary}
    </div>
    {c?.bio && <div className="pc-about"><h2>About</h2><p>{c.bio}</p></div>}
  </section>;
}

/** The editor. Saving and loading a hidden draft each ask the wallet for a free signature. */
export function ProfileCardEditor({ wallet, initial, onClose, onSaved }: { wallet: string; initial: ProfileCard | null; onClose: () => void; onSaved: (card: ProfileCard) => void }) {
  const { publicKey, signMessage } = useWallet();
  const embedded = useEmbeddedWallet();
  const usePhantom = publicKey?.toBase58() === wallet;
  const [card, setCard] = useState<ProfileCard>(initial ?? EMPTY_CARD);
  const [linkedin, setLinkedin] = useState((initial?.links ?? []).find(isLinkedIn) ?? "");
  const [others, setOthers] = useState((initial?.links ?? []).filter((l) => !isLinkedIn(l)).concat(["", ""]).slice(0, 2));
  const [skills, setSkills] = useState((initial?.skills ?? []).join(", "));
  const [busy, setBusy] = useState<null | "saving" | "loading">(null);
  const [error, setError] = useState("");
  const set = <K extends keyof ProfileCard>(k: K, v: ProfileCard[K]) => setCard((c) => ({ ...c, [k]: v }));

  async function sign(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text);
    const sig = usePhantom ? await signMessage!(bytes) : await embedded.signMessage(bytes);
    return bs58.encode(sig);
  }

  async function loadDraft() {
    setBusy("loading"); setError("");
    try {
      const signedAt = new Date().toISOString();
      const signature = await sign(cardReadMessage(wallet, signedAt));
      const res = await fetch(`/api/profile-card/${wallet}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "read", signedAt, signature }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error === "schema_not_ready" ? "Profiles aren’t set up yet: run db/06_profiles.sql in Supabase." : "Couldn’t load your saved profile."); return; }
      const c = data.card as ProfileCard;
      setCard(c); setLinkedin(c.links.find(isLinkedIn) ?? ""); setOthers(c.links.filter((l) => !isLinkedIn(l)).concat(["", ""]).slice(0, 2)); setSkills(c.skills.join(", "));
    } catch { setError("Signature cancelled."); } finally { setBusy(null); }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!usePhantom && embedded.address !== wallet) { setError("Connect the wallet this track record belongs to."); return; }
    const cleaned = cleanCard({ ...card, links: [linkedin, ...others].filter((l) => l.trim()), skills: skills.split(",") });
    if (!cleaned.ok) { setError(cleaned.message); return; }
    if (linkedin.trim() && !isLinkedIn(cleaned.card.links[0] ?? "")) { setError("The LinkedIn field needs a linkedin.com address, e.g. https://www.linkedin.com/in/your-name"); return; }
    setBusy("saving"); setError("");
    try {
      const signedAt = new Date().toISOString();
      const signature = await sign(cardSaveMessage(wallet, signedAt, cleaned.card));
      const res = await fetch(`/api/profile-card/${wallet}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save", card: cleaned.card, signedAt, signature }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { onSaved(data.card as ProfileCard); return; }
      setError(data.error === "schema_not_ready" ? "Profiles aren’t set up yet: run db/06_profiles.sql in Supabase."
        : data.error === "invalid_input" ? (data.message ?? "Check the fields and try again.")
        : data.error === "bad_signature" ? "The signature didn’t match this wallet. Try again." : "Couldn’t save right now. Try again.");
    } catch { setError("Signature cancelled. Nothing was saved."); } finally { setBusy(null); }
  }

  const years = Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 2 + i);
  return <div className="modal-overlay" onClick={() => !busy && onClose()}>
    <form role="dialog" aria-modal="true" aria-labelledby="pc-edit-title" className="modal pc-editor" onClick={(e) => e.stopPropagation()} onSubmit={save}>
      <button type="button" className="modal-close" aria-label="Close" disabled={!!busy} onClick={onClose}>×</button>
      <h2 id="pc-edit-title">Your profile</h2>
      <p>Shown at the top of your track record when you switch it on. Stored by ShowedUp, never on Solana.</p>
      {!initial && <button type="button" className="text-link pc-load" disabled={!!busy} onClick={loadDraft}>{busy === "loading" ? "Waiting for your wallet…" : "Saved a profile before? Load it"}</button>}
      <div className="pc-grid">
        <label className="field">Name<input value={card.displayName} maxLength={CARD_LIMITS.displayName} placeholder="e.g. Priya Sharma" onChange={(e) => set("displayName", e.target.value)} autoComplete="name"/></label>
        <label className="field">Headline<input value={card.headline} maxLength={CARD_LIMITS.headline} placeholder="e.g. CS student · Builders Club mentor" onChange={(e) => set("headline", e.target.value)}/></label>
        <label className="field">School<input value={card.school} maxLength={CARD_LIMITS.school} placeholder="e.g. University of British Columbia" onChange={(e) => set("school", e.target.value)}/></label>
        <div className="form-columns">
          <label className="field">Major<input value={card.major} maxLength={CARD_LIMITS.major} placeholder="e.g. Computer Science" onChange={(e) => set("major", e.target.value)}/></label>
          <label className="field">Class of<select value={card.gradYear ?? ""} onChange={(e) => set("gradYear", e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        </div>
        <label className="field">About<textarea rows={4} value={card.bio} maxLength={CARD_LIMITS.bio} placeholder="A few lines about you and what you like to work on." onChange={(e) => set("bio", e.target.value)}/><small>{card.bio.length}/{CARD_LIMITS.bio}</small></label>
        <label className="field">LinkedIn<input value={linkedin} placeholder="https://www.linkedin.com/in/your-name" onChange={(e) => setLinkedin(e.target.value)} inputMode="url" autoCapitalize="off" spellCheck={false}/></label>
        <div className="form-columns">
          {others.map((l, i) => <label className="field" key={i}>{i === 0 ? "Other link" : "Another link"}<input value={l} placeholder="https://github.com/…" onChange={(e) => setOthers((o) => o.map((x, j) => (j === i ? e.target.value : x)))} inputMode="url" autoCapitalize="off" spellCheck={false}/></label>)}
        </div>
        <label className="field">Skills<input value={skills} placeholder="Rust, Public speaking, Figma" onChange={(e) => setSkills(e.target.value)}/><small>Separate with commas. Up to {CARD_LIMITS.skills}.</small></label>
        <label className="check-field pc-public"><input type="checkbox" checked={card.isPublic} onChange={(e) => set("isPublic", e.target.checked)}/> Show on my track record (anyone with the link can see it)</label>
      </div>
      <button type="submit" className="button primary full" disabled={!!busy}>{busy === "saving" ? "Approve in your wallet…" : "Save profile"} <Icon name="arrow" size={16}/></button>
      {error && <p className="form-error" role="alert">{error}</p>}
      <small>Saving asks your wallet for a free signature so nobody else can edit your profile.</small>
    </form>
  </div>;
}
