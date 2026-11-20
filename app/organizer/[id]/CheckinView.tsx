"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Icon } from "@/components/Icon";
import { CopyText } from "@/components/CopyText";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { OrganizerAccessModal } from "@/components/OrganizerAccessModal";
import { formatDay, formatTime } from "@/lib/format";
import { explorerLink } from "@/lib/solana";
import { checkSession, clubHeaders, readSession, saveSession, type OrganizerSession } from "@/lib/organizerSession";
import { phantomBrowseLink } from "@/lib/phantom";
import { useEmbeddedWallet } from "@/lib/embeddedWallet";
import type { EventRecord } from "@/lib/server/events";
import type { Attendee } from "@/lib/server/members";

const POLL_MS = 3000;
const COUNT_POLL_MS = 8000;
const WINDOW_S = 30;
const ROSTER_POLL_MS = 4000;

export default function CheckinView({ event, club, siteUrl }: { event: EventRecord | null; club: { id: string; name: string }; siteUrl?: string }) {
  // With email / Google sign-in on, attendees don't need Phantom, so the QR opens the claim page itself.
  const signInEnabled = useEmbeddedWallet().enabled;
  // The officer's sign-in. It must be for the club this event belongs to.
  const [session, setSession] = useState<OrganizerSession | null>(null);
  const password = session?.password ?? null;
  const [checkedSaved, setCheckedSaved] = useState(false);
  const [accessModal, setAccessModal] = useState(false);
  const [accessError, setAccessError] = useState("");

  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [codeError, setCodeError] = useState("");
  const [origin, setOrigin] = useState("");
  const inFlight = useRef(false);
  const [attendees, setAttendees] = useState<number | null>(null);
  // Present mode: the same check-in, laid out full screen for a projector.
  const [presenting, setPresenting] = useState(false);
  const [countBump, setCountBump] = useState(false);
  const prevAttendees = useRef<number | null>(null);

  // The QR code points phones at PUBLIC_SITE_URL when it's set, otherwise at this page's own
  // address. A phone can't open "localhost", so that case gets a warning instead of a dead QR.
  useEffect(() => { setOrigin(siteUrl ?? window.location.origin); }, [siteUrl]);
  const localOnly = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(origin);

  // Use the sign-in saved on the organizer page if it is for this event's club; otherwise ask.
  useEffect(() => {
    const saved = readSession();
    if (!saved || saved.clubId !== club.id) { setCheckedSaved(true); setAccessModal(true); return; }
    checkSession(saved)
      .then((check) => {
        if (check.ok) setSession(saved);
        else { saveSession(null); setAccessModal(true); }
      })
      .catch(() => setSession(saved))
      .finally(() => setCheckedSaved(true));
  }, [club.id]);

  const fetchCode = useCallback(async () => {
    if (!session || !event || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/events/${event.id}/code`, {
        headers: clubHeaders(session),
        cache: "no-store",
      });
      if (res.status === 401) {
        saveSession(null);
        setSession(null);
        setCode(null);
        setAccessError("Your organizer session expired. Enter the passcode again.");
        setAccessModal(true);
        return;
      }
      if (!res.ok) { setCodeError("Couldn’t get a fresh code. Retrying…"); return; }
      const data = (await res.json()) as { code: string; expiresIn: number };
      setCode(data.code);
      setExpiresAt(Date.now() + data.expiresIn * 1000);
      setCodeError("");
    } catch {
      setCodeError("Lost connection to the server. Retrying…");
    } finally {
      inFlight.current = false;
    }
  }, [session, event]);

  // Poll for the code, and fetch right away when the countdown hits zero.
  useEffect(() => {
    if (!password) return;
    fetchCode();
    const poll = setInterval(fetchCode, POLL_MS);
    return () => clearInterval(poll);
  }, [password, fetchCode]);

  // Live check-in count, read from the event token's on-chain supply.
  useEffect(() => {
    if (!event) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/events?counts=1", { cache: "no-store" });
        const data = (await res.json()) as { events: { id: string; attendees?: number }[] };
        const mine = data.events.find((e) => e.id === event.id);
        if (!cancelled && mine?.attendees !== undefined) setAttendees(mine.attendees);
      } catch {}
    };
    load();
    const poll = setInterval(load, COUNT_POLL_MS);
    return () => { cancelled = true; clearInterval(poll); };
  }, [event]);

  // "Who's here": names of everyone who has claimed, newest first (organizer password needed).
  const [roster, setRoster] = useState<Attendee[] | null>(null);
  // True when this club can take back this badge (newer badges only); then each name gets "Revoke".
  const [revocable, setRevocable] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState("");
  const [rosterTick, setRosterTick] = useState(0);
  useEffect(() => {
    if (!event || !session) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/events/${event.id}/attendees`, {
          headers: clubHeaders(session),
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { attendees: Attendee[]; revocable?: boolean };
        if (!cancelled) { setRoster(data.attendees); setRevocable(!!data.revocable); }
      } catch {}
    };
    load();
    const poll = setInterval(load, ROSTER_POLL_MS);
    return () => { cancelled = true; clearInterval(poll); };
  }, [event, session, rosterTick]);

  // Take back a badge given by mistake: the club burns that person's token on Solana.
  const revoke = async (a: Attendee) => {
    if (!event || !session || revoking) return;
    if (!window.confirm(`Take back this badge from ${a.name}? It is removed from their track record on Solana. This can't be undone.`)) return;
    setRevoking(a.wallet);
    setRevokeError("");
    try {
      const res = await fetch(`/api/events/${event.id}/revoke`, {
        method: "POST",
        headers: { ...clubHeaders(session), "content-type": "application/json" },
        body: JSON.stringify({ wallet: a.wallet }),
      });
      if (res.status === 401) setRevokeError("Your officer sign-in has expired. Reload the page and enter the passcode again.");
      else if (res.status === 409) setRevokeError("This badge was created before badges could be taken back.");
      else if (!res.ok) setRevokeError(`Couldn’t take back ${a.name}’s badge. Try again in a moment.`);
    } catch {
      setRevokeError("Lost connection to the server. Try again in a moment.");
    } finally {
      setRevoking(null);
      setRosterTick((t) => t + 1);
    }
  };

  // Add someone who missed the scan: pick one of the club's members or paste a wallet. Mints the
  // same attendance badge a scan would; the list then marks them "Added by officer".
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [members, setMembers] = useState<{ wallet: string; name: string }[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [addNote, setAddNote] = useState<{ ok: boolean; text: ReactNode } | null>(null);
  useEffect(() => {
    if (!addOpen || !session || members !== null) return;
    fetch(`/api/clubs/${club.id}/members`, { headers: clubHeaders(session), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d: { members?: { wallet: string; name: string }[] }) => setMembers(d.members ?? []))
      .catch(() => setMembers([]));
  }, [addOpen, session, members, club.id]);
  const here = new Set((roster ?? []).map((a) => a.wallet));
  const q = addQuery.trim();
  const looksLikeWallet = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);
  const suggestions = !q || looksLikeWallet ? [] : (members ?? [])
    .filter((m) => !here.has(m.wallet) && m.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
  const addPerson = async (wallet: string, label: string) => {
    if (!event || !session || adding) return;
    setAdding(wallet);
    setAddNote(null);
    try {
      const res = await fetch(`/api/events/${event.id}/attendance`, {
        method: "POST",
        headers: { ...clubHeaders(session), "content-type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === "awarded") { setAddNote({ ok: true, text: `${label} was added. Their badge is on Solana.` }); setAddQuery(""); }
      else if (res.ok) setAddNote({ ok: true, text: `${label} already has this badge.` });
      else if (data.error === "schema_not_ready") setAddNote({ ok: false, text: "Run db/05_manual_attendance.sql in Supabase first, then try again." });
      else if (data.error === "organizer_unfunded") setAddNote({ ok: false, text: <>The organizer wallet needs devnet SOL. Fund <CopyText value={String(data.organizer)}/> at <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>.</> });
      else if (data.error === "invalid_wallet") setAddNote({ ok: false, text: "That isn’t a Solana wallet address." });
      else if (res.status === 401) setAddNote({ ok: false, text: "Your officer sign-in has expired. Reload and enter the passcode again." });
      else if (res.status === 409) setAddNote({ ok: false, text: "Already being added. Give it a few seconds." });
      else setAddNote({ ok: false, text: "Couldn’t add them right now. Try again in a moment." });
    } catch {
      setAddNote({ ok: false, text: "Lost connection to the server. Try again in a moment." });
    } finally {
      setAdding(null);
      setRosterTick((t) => t + 1);
    }
  };

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (expiresAt !== null && now >= expiresAt) fetchCode();
  }, [now, expiresAt, fetchCode]);

  useEffect(() => {
    if (attendees !== null && prevAttendees.current !== null && attendees > prevAttendees.current) {
      setCountBump(true);
      const t = setTimeout(() => setCountBump(false), 500);
      return () => clearTimeout(t);
    }
    prevAttendees.current = attendees;
  }, [attendees]);

  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") { setAccessModal(false); setPresenting(false); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  // Present mode also asks the browser for real full screen. If the browser leaves full screen
  // (Esc), leave present mode too; if the password prompt needs to show, get out of its way.
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setPresenting(false); };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    if (accessModal) setPresenting(false);
  }, [accessModal]);
  useEffect(() => {
    if (!presenting && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, [presenting]);
  const startPresenting = () => {
    setPresenting(true);
    // Not every browser (or embedded view) allows full screen; the layout works without it.
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  if (!event) {
    return <><SiteHeader view="event" /><main className="shell"><Link className="back-link" href="/organizer">← All events</Link><div className="center-page"><div className="claim-panel"><div className="large-symbol neutral-symbol"><Icon name="calendar" size={32}/></div><h1>We couldn’t find that event.</h1><p>Check the link, or head back to your events.</p><Link className="button primary full" href="/organizer" style={{marginTop: 25}}>All events <Icon name="arrow" size={16}/></Link></div></div></main><SiteFooter /></>;
  }

  // How many of the names were reported by the QuickNode Stream watching Solana (0 = no stream).
  const streamedCount = roster ? roster.filter((a) => a.source === "stream").length : 0;
  const seconds = expiresAt === null ? WINDOW_S : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const urgency = seconds <= 5 ? "countdown-urgent" : seconds <= 10 ? "countdown-warning" : "";
  const claimUrl = code && origin ? `${origin}/claim/${event.id}?c=${code}` : "";
  // Phones scan with the camera. With sign-in on, the QR opens the claim page in the phone's
  // browser (it still offers "Open in Phantom"); without it, straight inside Phantom as before.
  const qrValue = claimUrl ? (signInEnabled ? claimUrl : phantomBrowseLink(claimUrl, origin)) : "";

  return <><SiteHeader view="event" />
  <main className="shell ci">
    <div className="ci-head">
      <div className="ci-title">
        <Link className="ci-back" href="/organizer">← {club.name}</Link>
        <h1>{event.name}</h1>
        <p>{formatDay(event.date)} · {formatTime(event.date)}{event.location && <> · {event.location}</>} · <a href={explorerLink(event.mint)} target="_blank" rel="noreferrer">Badge on Solana <Icon name="external" size={13}/></a></p>
      </div>
      <button type="button" className="button primary ci-present present-open" onClick={startPresenting}>Present on a projector <Icon name="external" size={15}/></button>
    </div>
    <div className="ci-grid">
      <section className={`ci-card ci-qr qr-panel${urgency ? " " + urgency : ""}`} aria-label="Check-in QR code">
        <div className="ci-card-head"><span className="ci-live">Check-in is open</span><span className="ci-how">{signInEnabled ? "Scan with a phone camera · sign in · tap Claim" : "Scan with a phone camera · opens in Phantom · tap Claim"}</span></div>
        <div className="qr-wrap">{claimUrl
          ? <QRCodeSVG value={qrValue} size={260} fgColor="#0d1f78" level="M" marginSize={1}/>
          : <div style={{aspectRatio: "1", display: "grid", placeItems: "center"}}><p>{!checkedSaved || password ? "Loading code…" : "Club passcode needed to show the code."}</p></div>}</div>
        <div className="code-line">CODE <strong>{code ?? "······"}</strong><span>{code ? `New code in ${seconds}s` : ""}</span></div>
        <div className="countdown-track"><div style={{width: `${seconds / WINDOW_S * 100}%`}}/></div>
        {codeError && <p className="form-error" role="alert">{codeError}</p>}
        {localOnly && <p className="form-error" role="alert">Phones can’t open “localhost”, so this QR code won’t work on a phone. Open this page from the Vercel link (or a tunnel link), or set PUBLIC_SITE_URL on the server.</p>}
        {!password && checkedSaved
          ? <button className="text-link qr-link" onClick={() => { setAccessError(""); setAccessModal(true); }}>Enter club passcode <Icon name="arrow" size={16}/></button>
          : claimUrl && <a href={claimUrl} target="_blank" rel="noreferrer" className="text-link qr-link">Open the attendee screen <Icon name="arrow" size={16}/></a>}
      </section>
      <aside className="ci-card ci-roster roster-panel" aria-label="Who’s here">
        <div className={`ci-count${countBump ? " count-bump" : ""}`} aria-live="polite"><strong>{attendees ?? "–"}</strong><span>{attendees === 1 ? "person showed up" : "people showed up"}</span></div>
        <div className="roster-head"><h2>Who’s here</h2>{roster && <span className="roster-count">{roster.length}</span>}{session && <button type="button" className="ci-add-toggle" aria-expanded={addOpen} onClick={() => { setAddOpen(!addOpen); setAddNote(null); }}>{addOpen ? "Done" : "+ Add someone"}</button>}</div>
        {addOpen && session && <div className="ci-add">
          <input value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder="Search members or paste a wallet" aria-label="Search members or paste a wallet address" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus/>
          {looksLikeWallet && <button type="button" className="ci-add-option" disabled={adding !== null} onClick={() => addPerson(q, `${q.slice(0, 4)}…${q.slice(-4)}`)}><span>Add wallet <code>{q.slice(0, 4)}…{q.slice(-4)}</code></span><b>{adding === q ? "Adding…" : here.has(q) ? "Already here" : "Add"}</b></button>}
          {suggestions.map((m) => <button type="button" key={m.wallet} className="ci-add-option" disabled={adding !== null} onClick={() => addPerson(m.wallet, m.name)}><span>{m.name} <code>{m.wallet.slice(0, 4)}…{m.wallet.slice(-4)}</code></span><b>{adding === m.wallet ? "Adding…" : "Add"}</b></button>)}
          {q && !looksLikeWallet && members !== null && suggestions.length === 0 && <p className="ci-add-hint">No member by that name. Paste their wallet address instead.</p>}
          {!q && <p className="ci-add-hint">For someone who was here but missed the scan. Mints the same badge a scan would; your club covers the fee.</p>}
          {addNote && <p className={addNote.ok ? "ci-add-ok" : "form-error"} role="status">{addNote.text}</p>}
        </div>}
        <div className="roster-body">{roster === null
          ? <p className="roster-empty">{!checkedSaved || password ? "Loading names…" : "Enter the club passcode to see who’s here."}</p>
          : roster.length === 0
            ? <div className="roster-empty"><Icon name="people" size={22}/><p>Names show up here as people check in.</p></div>
            : <ol className="roster-list">{roster.map((a) => <li key={a.wallet} className={revocable ? "has-revoke" : undefined}>{a.name}{a.addedByOfficer && <span className="ci-added-tag">Added by officer</span>}{revocable && <button type="button" className="text-link revoke-button" disabled={revoking !== null} onClick={() => revoke(a)}>{revoking === a.wallet ? "Revoking…" : "Revoke"}</button>}</li>)}</ol>}</div>
        {revokeError && <p className="form-error revoke-error" role="alert">{revokeError}</p>}
        {streamedCount > 0 && roster && <small className="ci-stream">{streamedCount} of {roster.length} seen live on Solana · QuickNode Streams</small>}
      </aside>
    </div>
  </main><SiteFooter />
  {presenting && <div className={`present${urgency ? " " + urgency : ""}`} role="dialog" aria-modal="true" aria-label={`Check-in for ${event.name}, full screen`}>
    <button type="button" className="present-exit" onClick={() => setPresenting(false)}>Exit <kbd>Esc</kbd></button>
    <div className="present-qr">
      <div className="present-qr-box">{claimUrl
        ? <QRCodeSVG value={qrValue} size={560} fgColor="#0d1f78" level="M" marginSize={1}/>
        : <p>{!checkedSaved || password ? "Loading code…" : "Club passcode needed to show the code."}</p>}</div>
      <div className="present-code"><span>CODE</span><strong>{code ?? "······"}</strong></div>
      <div className="present-track"><div style={{width: `${seconds / WINDOW_S * 100}%`}}/></div>
      <small className="present-refresh">{code ? `New code in ${seconds}s` : "\u00a0"}</small>
    </div>
    <div className="present-info">
      <span className="brand"><span className="brand-mark">↗</span>ShowedUp</span>
      <h1>{event.name}<span className="green-period">.</span></h1>
      <p className="present-how">{signInEnabled ? "Scan with your phone camera · Sign in with email or Google · Tap Claim" : "Scan with your phone camera · It opens in Phantom · Tap Claim"}</p>
      <div className={`present-count${countBump ? " count-bump" : ""}`} aria-live="polite"><strong>{attendees ?? "–"}</strong><span>{attendees === 1 ? "person showed up" : "people showed up"}</span></div>
      {roster && roster.length > 0 && <ol className="present-names" aria-label="Latest check-ins">{roster.slice(0, 6).map((a) => <li key={a.wallet}>{a.name}</li>)}</ol>}
    </div>
  </div>}
  {accessModal && <OrganizerAccessModal fixedClub={club} initialError={accessError} onClose={() => setAccessModal(false)} onUnlocked={(unlocked) => { setSession(unlocked.session); setAccessModal(false); setAccessError(""); }} />}
  </>;
}
