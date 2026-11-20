"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Badge } from "@/components/Badge";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { fetchProfile, type Profile } from "@/lib/profileClient";

export default function VerifyView() {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Profile | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const wallet = address.trim();
    setResult(null);
    if (!wallet) { setError("Enter a Solana wallet address."); return; }
    setBusy(true);
    setError("");
    const r = await fetchProfile(wallet);
    setBusy(false);
    if (r.ok) setResult(r.profile);
    else setError(r.error === "invalid_wallet" ? "That isn’t a valid Solana wallet address." : "Couldn’t reach Solana devnet. Try again in a moment.");
  }

  return <><SiteHeader view="verify" />
  <main className="shell claim-v2"><div className="center-page"><Link href="/profile/me" className="back-link">← My track record</Link><form className="claim-panel" onSubmit={submit}><div className="large-symbol"><Icon name="shield" size={32}/></div><Badge>Verify attendance</Badge><h1>Presence, with proof.</h1><p>Look up public token badges. For a private contribution, ask the student to share their receipt.</p><label className="field">Wallet address<input placeholder="Enter a Solana wallet address" value={address} onChange={e => setAddress(e.target.value)} autoComplete="off" spellCheck={false}/></label><button type="submit" className="button primary full" disabled={busy}>{busy ? "Checking the chain…" : "Verify attendance"} <Icon name="arrow" size={16}/></button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {result && <div className="verification-result"><Icon name={result.events.length > 0 ? "check" : "shield"}/><div><strong>{result.count > 0 ? `${result.tier} · ${result.count} ${result.count === 1 ? "event" : "events"}` : result.events.length > 0 ? "No attendance yet" : "No public badges yet"}{result.contributions > 0 ? ` · ${result.contributions} ${result.contributions === 1 ? "contribution" : "contributions"}` : ""}</strong><p>Verified clubs only · read from Solana devnet</p></div><Link className="pill-link" href={`/profile/${result.wallet}`}>View track record <Icon name="arrow" size={14}/></Link></div>}
    <small className="claim-note">Attendance is read directly from the blockchain. Anyone can check it, and it can’t be faked.</small></form></div></main><SiteFooter /></>;
}
