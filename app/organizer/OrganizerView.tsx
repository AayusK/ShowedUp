"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Badge } from "@/components/Badge";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { dateTile, formatDay, formatEventDetail } from "@/lib/format";
import { explorerLink } from "@/lib/solana";
import { checkSession, clubHeaders, readSession, saveSession, type OrganizerSession } from "@/lib/organizerSession";
import { OrganizerAccessModal, type Unlocked } from "@/components/OrganizerAccessModal";
import { LEGACY_CLUB_ID, LEGACY_CLUB_NAME, type ClubInfo } from "@/lib/clubs";
import { ClubsPanel } from "./ClubsPanel";
import { AwardModal, type AwardTarget } from "./AwardModal";
import { OpeningsPanel } from "./OpeningsPanel";

interface EventItem {
  id: string;
  name: string;
  date: string;
  location?: string;
  mint: string;
  createdAt: string;
  attendees?: number;
  /** "contribution" badges are awarded by an officer; everything else is QR-code attendance. */
  kind?: string;
  role?: string;
}

function useCountUp(target: number | null, duration = 900): number {
  const [val, setVal] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (target === null) return;
    const finalVal = target;
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    const start = performance.now();
    function step(now: number) {
      const p = Math.min((now - start) / duration, 1);
      setVal(Math.round(finalVal * (1 - (1 - p) ** 3)));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);
  return val;
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function OrganizerView() {
  const router = useRouter();
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Which club the officer is signed in to (and its passcode). Signed out, the page shows the
  // default club's events, as it did before clubs existed.
  const [session, setSession] = useState<OrganizerSession | null>(null);
  const [club, setClub] = useState<ClubInfo | null>(null);
  const [admin, setAdmin] = useState(false);
  const password = session?.password ?? null;
  const clubId = session?.clubId ?? LEGACY_CLUB_ID;

  const [accessModal, setAccessModal] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [openCreateAfterAccess, setOpenCreateAfterAccess] = useState(false);

  const [createModal, setCreateModal] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [location, setLocation] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  // "Award contribution": false = closed, null = a new badge, or the existing badge to award.
  const [award, setAward] = useState<AwardTarget | null | false>(false);
  const [createError, setCreateError] = useState<ReactNode>("");

  // Signing in switches which club's events are listed. If an older request answers after a
  // newer one, its result is dropped.
  const loadSeq = useRef(0);
  const loadEvents = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const res = await fetch(`/api/events?counts=1&club=${clubId}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { events: EventItem[] };
      if (seq !== loadSeq.current) return;
      setEvents([...data.events].sort((a, b) => b.date.localeCompare(a.date)));
      setLoadError(false);
    } catch {
      if (seq !== loadSeq.current) return;
      setLoadError(true);
      setEvents([]);
    }
  }, [clubId]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Restore the sign-in for this browser session, dropping it if it no longer works.
  useEffect(() => {
    const saved = readSession();
    if (!saved) return;
    checkSession(saved).then((check) => {
      if (check.ok) { setSession(saved); setClub(check.club ?? null); setAdmin(!!check.admin); }
      else saveSession(null);
    }).catch(() => setSession(saved));
  }, []);

  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape" && !createBusy) { setCreateModal(false); setAccessModal(false); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [createBusy]);

  function openCreate() {
    if (!password) { setOpenCreateAfterAccess(true); setAccessModal(true); return; }
    if (!date) setDate(todayLocal());
    setCreateError("");
    setCreateModal(true);
  }

  function onUnlocked(unlocked: Unlocked) {
    setSession(unlocked.session);
    setClub(unlocked.club);
    setAdmin(unlocked.admin);
    setAccessModal(false);
    setAccessError("");
    if (openCreateAfterAccess) {
      setOpenCreateAfterAccess(false);
      if (!date) setDate(todayLocal());
      setCreateError("");
      setCreateModal(true);
    }
  }

  function lock() {
    saveSession(null);
    setSession(null);
    setClub(null);
    setAdmin(false);
  }

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    if (!session) return;
    if (!name.trim()) { setCreateError("Give your event a name."); return; }
    if (!date || !time) { setCreateError("Pick a date and time."); return; }
    setCreateBusy(true);
    setCreateError("");
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", ...clubHeaders(session) },
        body: JSON.stringify({ name, date: `${date}T${time}`, location }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // Straight to the new event's check-in QR code.
        setCreateModal(false);
        if (data.event?.id) { router.push(`/organizer/${data.event.id}`); return; }
        await loadEvents();
        return;
      }
      switch (data.error) {
        case "unauthorized":
          lock();
          setCreateModal(false);
          setOpenCreateAfterAccess(true);
          setAccessError("Your organizer session expired. Enter the passcode again.");
          setAccessModal(true);
          break;
        case "organizer_unfunded":
          setCreateError(<>The organizer wallet needs devnet SOL. Fund <strong>{data.organizer}</strong> at <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>, then try again.</>);
          break;
        case "club_key_not_configured":
          setCreateError("This club’s wallet isn’t set up. Check CLUB_KEY_SECRET in the server’s settings.");
          break;
        case "organizer_not_configured":
          setCreateError("The organizer key isn’t set up. Add ORGANIZER_SECRET_KEY to .env.local and restart the server.");
          break;
        case "invalid_input":
          setCreateError(data.message ?? "Check the event details and try again.");
          break;
        default:
          setCreateError("Couldn’t reach Solana devnet. Wait a moment and try again.");
      }
    } catch {
      setCreateError("Couldn’t reach the server. Try again.");
    } finally {
      setCreateBusy(false);
    }
  }

  // "Events hosted" and "check-ins" count attendance events; contribution badges are listed but
  // aren't check-ins.
  const hosted = events?.filter(e => e.kind !== "contribution") ?? [];
  const count = hosted.length;
  // Only show check-ins when every event has an on-chain count; never a made-up number.
  const checkins = hosted.length > 0 && hosted.every(e => e.attendees !== undefined)
    ? hosted.reduce((sum, e) => sum + (e.attendees ?? 0), 0)
    : null;

  const animCount = useCountUp(events !== null ? count : null);
  const animCheckins = useCountUp(checkins);

  return <><SiteHeader view="organizer" />
  <main className="shell">
    <div className="page-intro"><div className="organizer-access"><Badge>Organizer workspace</Badge>{password
      ? <button className="text-link" onClick={lock}><Icon name="shield" size={14}/> Organizer access · Lock</button>
      : <button className="text-link" onClick={()=>{ setOpenCreateAfterAccess(false); setAccessError(""); setAccessModal(true); }}><Icon name="shield" size={14}/> Organizer access</button>}</div><h1>Bring people together.</h1><p>You make the space. We’ll remember who showed up.</p></div>
    <div className="stats" style={{gridTemplateColumns: `repeat(${checkins !== null ? 2 : 1}, 1fr)`}}><div><span>Events hosted</span><strong>{events === null ? "–" : animCount}</strong><small>{count === 0 ? "Your first one is a click away" : "A growing community"}</small></div>{checkins !== null && <div><span>Total check-ins</span><strong>{animCheckins}</strong><small>{checkins === 1 ? "1 moment of connection" : `${checkins} moments of connection`}</small></div>}</div>
    <div className="section-heading"><div><span className="eyebrow">{(club?.name ?? (clubId === LEGACY_CLUB_ID ? LEGACY_CLUB_NAME : "Your club")).toUpperCase()}</span><h2>Your events</h2></div><div className="heading-actions">{session && <button className="button secondary" onClick={() => setAward(null)}><Icon name="spark" size={17}/> Award contribution</button>}<button className="button primary" onClick={openCreate}><Icon name="plus" size={17}/> Create event</button></div></div>
    <div className="panel event-list">
      {events === null && [0, 1, 2].map(i => <div className="event-row" key={i}><div className="skeleton" style={{width:45,height:51,borderRadius:10,flexShrink:0}}/><div style={{flex:1,display:"flex",flexDirection:"column",gap:8}}><div className="skeleton" style={{height:17,width:"50%"}}/><div className="skeleton" style={{height:11,width:"32%",marginTop:4}}/></div></div>)}
      {events !== null && events.length === 0 && <div className="event-row"><div className="event-info"><h3>{loadError ? "Couldn’t load events." : "No events yet."}</h3><p>{loadError ? "Refresh the page to try again." : "Create your first event to get a check-in QR code."}</p></div></div>}
      {events?.map((e, i) => { const tile = dateTile(e.date); return <div className="event-row" key={e.id} style={{"--row-i": i} as React.CSSProperties}><div className="date-tile"><small>{tile.month}</small>{tile.day}</div><div className="event-info"><h3>{e.name}</h3><p>{e.kind === "contribution" ? `${e.role} badge · ${formatDay(e.date)}` : formatEventDetail(e.date, e.location)}</p></div>{e.attendees !== undefined && <span className="row-count"><Icon name="people" size={16}/>{e.attendees} {e.kind === "contribution" ? (e.attendees === 1 ? "recipient" : "recipients") : (e.attendees === 1 ? "attendee" : "attendees")}</span>}<a className="pill-link" href={explorerLink(e.mint)} target="_blank" rel="noreferrer">Event token <Icon name="external" size={14}/></a><Link className="button secondary" href={`/organizer/${e.id}`}>{e.kind === "contribution" ? "View recipients" : "Open check-in"}<Icon name="arrow" size={16}/></Link></div>; })}
    </div>
    <div className="subtle-notice"><Icon name="shield"/>Creating an event needs your club’s passcode. Each event gets its own nontransferable token on Solana devnet, issued from your club’s wallet.</div>
    {admin && session && <ClubsPanel adminPassword={session.password} />}
    {session && <OpeningsPanel session={session} club={club} />}
  </main><SiteFooter />
  {award !== false && session && <AwardModal session={session} existing={award ?? undefined} onClose={() => setAward(false)} onChanged={loadEvents} />}
  {accessModal && <OrganizerAccessModal initialError={accessError} onClose={()=>setAccessModal(false)} onUnlocked={onUnlocked} />}
  {createModal && <div className="modal-overlay" onClick={()=>!createBusy && setCreateModal(false)}><form role="dialog" aria-modal="true" aria-label="Create event" className="modal" onClick={e=>e.stopPropagation()} onSubmit={submitCreate}><button type="button" className="modal-close" aria-label="Close" disabled={createBusy} onClick={()=>setCreateModal(false)}>×</button><span className="eyebrow">MAKE ROOM FOR SOMETHING GOOD</span><h2>A reason to show up.</h2><p>Create an event for your community.</p><label className="field">Event name<input value={name} maxLength={80} placeholder="e.g. Builders Meeting" onChange={e=>setName(e.target.value)}/></label><div className="form-columns"><label className="field">Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label className="field">Time<input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label></div><label className="field">Location<input value={location} maxLength={80} placeholder="e.g. UBC Nest, Room 2504 (optional)" onChange={e=>setLocation(e.target.value)}/></label><button type="submit" className="button primary full" disabled={createBusy}>{createBusy ? "Creating event token…" : "Create event"} <Icon name="arrow" size={16}/></button>{createError && <p className="form-error" role="alert">{createError}</p>}<small>Creates a nontransferable Token-2022 token on Solana devnet. The organizer wallet pays the fee. Takes a few seconds.</small></form></div>}
  </>;
}
