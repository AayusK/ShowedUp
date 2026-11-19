"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Icon } from "@/components/Icon";
import { Badge } from "@/components/Badge";
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
  <main className="shell">
    <Link className="back-link" href="/organizer">← All events</Link>
    <div className="checkin-layout with-roster"><div><Badge>{club.name} · Check-in is open</Badge><h1>{event.name}<span className="green-period">.</span></h1><p className="lead">{formatDay(event.date)} · {formatTime(event.date)}{event.location && <><br/>{event.location}</>}</p><div className="instructions"><div><b>01</b><span>Scan the code<small>{signInEnabled ? "Use your phone camera. No app to install." : "Use your phone camera. It opens in Phantom."}</small></span></div><div><b>02</b><span>{signInEnabled ? "Sign in" : "Connect your wallet"}<small>{signInEnabled ? "Email or Google. Your attendance goes where you go." : "Your attendance goes where you go."}</small></span></div><div><b>03</b><span>Make it official<small>Tap Claim. Your organizer covers the fees.</small></span></div></div>{attendees !== null && <div className={`live-attendees${countBump ? " count-bump" : ""}`}><Icon name="people" size={18}/><strong>{attendees === 0 ? "Waiting for the first check-in" : `${attendees} ${attendees === 1 ? "person" : "people"} showed up`}</strong></div>}<button type="button" className="button secondary present-open" onClick={startPresenting}>Present on a projector <Icon name="external" size={15}/></button></div>
      <div className={`qr-panel${urgency ? " " + urgency : ""}`}><div className="qr-title"><span className="brand mini"><span className="brand-mark">↗</span>ShowedUp</span><span className="quiet-pill">DEVNET</span></div><h2>You’re in the right place.</h2><p>Scan to claim your attendance.</p>
        <div className="qr-wrap">{claimUrl
          ? <QRCodeSVG value={qrValue} size={224} fgColor="#173d2d" level="M" marginSize={1}/>
          : <div style={{aspectRatio: "1", display: "grid", placeItems: "center"}}><p>{!checkedSaved || password ? "Loading code…" : "Club passcode needed to show the code."}</p></div>}</div>
        <div className="code-line">CODE <strong>{code ?? "······"}</strong><span>Refreshes in {seconds}s</span></div>
        <div className="countdown-track"><div style={{width: `${seconds / WINDOW_S * 100}%`}}/></div>
        {codeError && <p className="form-error" role="alert">{codeError}</p>}
        {!password && checkedSaved
          ? <button className="text-link qr-link" onClick={() => { setAccessError(""); setAccessModal(true); }}>Enter club passcode <Icon name="arrow" size={16}/></button>
          : claimUrl && <a href={claimUrl} target="_blank" rel="noreferrer" className="text-link qr-link">Open attendee screen <Icon name="arrow" size={16}/></a>}
        {localOnly && <p className="form-error" role="alert">Phones can’t open “localhost”, so this QR code won’t work on a phone. Open this page from the Vercel link (or a tunnel link), or set PUBLIC_SITE_URL on the server.</p>}
        <small className="qr-disclaimer">Each code works for up to a minute, then scan again.</small>
      </div>
      <aside className="roster-panel" aria-label="Who’s here"><div className="roster-head"><h2>Who’s here</h2>{roster && <span className="roster-count" aria-live="polite">{roster.length}</span>}</div>
        <div className="roster-body">{roster === null
          ? <p className="roster-empty">{!checkedSaved || password ? "Loading names…" : "Enter the club passcode to see who’s here."}</p>
          : roster.length === 0
            ? <div className="roster-empty"><Icon name="people" size={22}/><p>Names show up here as people check in.</p></div>
            : <ol className="roster-list">{roster.map((a) => <li key={a.wallet} className={revocable ? "has-revoke" : undefined}>{a.name}{revocable && <button type="button" className="text-link revoke-button" disabled={revoking !== null} onClick={() => revoke(a)}>{revoking === a.wallet ? "Revoking…" : "Revoke"}</button>}</li>)}</ol>}</div>
        {revokeError && <p className="form-error revoke-error" role="alert">{revokeError}</p>}
        {streamedCount > 0 && roster && <small className="qr-disclaimer" style={{margin: "10px 0 12px", padding: "0 24px", textAlign: "center"}}>{streamedCount} of {roster.length} seen live on Solana · QuickNode Streams</small>}
      </aside></div>
    <div className="token-details"><Icon name="shield" size={17}/><span>Event token<small>{event.name} · Token-2022 · Nontransferable · 0 decimals</small></span><a className="pill-link" href={explorerLink(event.mint)} target="_blank" rel="noreferrer">View on Explorer <Icon name="external" size={14}/></a></div>
  </main><SiteFooter />
  {presenting && <div className={`present${urgency ? " " + urgency : ""}`} role="dialog" aria-modal="true" aria-label={`Check-in for ${event.name}, full screen`}>
    <button type="button" className="present-exit" onClick={() => setPresenting(false)}>Exit <kbd>Esc</kbd></button>
    <div className="present-qr">
      <div className="present-qr-box">{claimUrl
        ? <QRCodeSVG value={qrValue} size={560} fgColor="#173d2d" level="M" marginSize={1}/>
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
