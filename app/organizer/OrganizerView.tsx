"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { SiteHeader } from "@/components/SiteHeader";
import { formatDay } from "@/lib/format";
import { explorerLink } from "@/lib/solana";
import { termOf } from "@/lib/trackRecord";
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
  const [sessionChecked, setSessionChecked] = useState(false);
  useEffect(() => {
    const saved = readSession();
    if (!saved) { setSessionChecked(true); return; }
    checkSession(saved).then((check) => {
      if (check.ok) { setSession(saved); setClub(check.club ?? null); setAdmin(!!check.admin); }
      else saveSession(null);
    }).catch(() => setSession(saved)).finally(() => setSessionChecked(true));
  }, []);

  // Which part of the dashboard is open: the club's events, its openings, or (registry admin
  // only) the list of clubs.
  const [tab, setTab] = useState<"events" | "openings" | "clubs">("events");
  // How many applications are waiting for a decision, for the dot on the Openings icon.
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!session) { setPending(0); return; }
    let cancelled = false;
    fetch("/api/openings?mine=1", { cache: "no-store", headers: clubHeaders(session) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { openings?: { pending?: number }[] } | null) => {
        if (!cancelled) setPending((d?.openings ?? []).reduce((n, o) => n + (o.pending ?? 0), 0));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [session, tab]);

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
    setTab("events");
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

  // Upcoming attendance events (today or later) soonest first; everything else newest first.
  const today = todayLocal();
  const upcoming = (events ?? []).filter((e) => e.kind !== "contribution" && e.date.slice(0, 10) >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const past = (events ?? []).filter((e) => !upcoming.includes(e));
  const hosted = (events ?? []).filter((e) => e.kind !== "contribution");
  // Only show check-ins when every event has an on-chain count; never a made-up number.
  const checkins = hosted.length > 0 && hosted.every((e) => e.attendees !== undefined)
    ? hosted.reduce((sum, e) => sum + (e.attendees ?? 0), 0) : null;
  const badges = (events ?? []).filter((e) => e.kind === "contribution").reduce((n, e) => n + (e.attendees ?? 0), 0);
  const clubName = club?.name ?? (clubId === LEGACY_CLUB_ID ? LEGACY_CLUB_NAME : "Your club");
  const initials = clubName.split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "C";

  // The ··· menu on an event row: which row's menu is open.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  useEffect(() => {
    if (!menuFor) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.type === "pointerdown" && (e.target as HTMLElement).closest?.(".dash-menu-wrap")) return;
      setMenuFor(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); };
  }, [menuFor]);
  const term = termOf(today)?.label;

  function openAccess() { setOpenCreateAfterAccess(false); setAccessError(""); setAccessModal(true); }

  const eventRow = (e: EventItem, next = false) => {
    const contribution = e.kind === "contribution";
    return <li key={e.id} className={`dash-row${next ? " dash-row-next" : ""}`}>
      <span className="dash-date">{formatDay(e.date).replace(/, \d{4}$/, "")}</span>
      <span className="dash-name"><strong>{e.name}</strong>{contribution
        ? <span className="dash-tag">{e.role} badge</span>
        : e.location && <span className="dash-sub">{e.location}</span>}</span>
      {next
        ? <Link className="button primary dash-go" href={`/organizer/${e.id}`}>Start check-in <Icon name="arrow" size={15}/></Link>
        : <>
          {e.attendees !== undefined && <span className="dash-num">{e.attendees}<small>{contribution ? (e.attendees === 1 ? " recipient" : " recipients") : " came"}</small></span>}
        </>}
      <div className="dash-menu-wrap">
        <button type="button" className="dash-more" aria-haspopup="menu" aria-expanded={menuFor === e.id} aria-label={`Actions for ${e.name}`} onClick={() => setMenuFor(menuFor === e.id ? null : e.id)}>···</button>
        {menuFor === e.id && <div className="dash-menu" role="menu">
          {contribution ? <>
            <Link role="menuitem" href={`/organizer/${e.id}`}><Icon name="people" size={16}/> See recipients</Link>
            <button role="menuitem" type="button" onClick={() => { setMenuFor(null); setAward({ id: e.id, name: e.name, role: e.role }); }}><Icon name="spark" size={16}/> Award to more people</button>
          </> : <>
            <Link role="menuitem" href={`/organizer/${e.id}`}><Icon name="calendar" size={16}/> {next ? "Start check-in" : "Open check-in"}</Link>
            <Link role="menuitem" href={`/organizer/${e.id}`}><Icon name="people" size={16}/> Who showed up</Link>
          </>}
          <a role="menuitem" href={explorerLink(e.mint)} target="_blank" rel="noreferrer"><Icon name="external" size={16}/> View badge on Solana</a>
        </div>}
      </div>
    </li>;
  };

  return <><SiteHeader view="organizer" />
  <main className="dash">
    <nav className="dash-rail" aria-label="Club dashboard">
      <button type="button" className={tab === "events" ? "on" : ""} onClick={() => setTab("events")} aria-current={tab === "events" ? "page" : undefined}><Icon name="calendar" size={19}/><span>Events</span></button>
      <button type="button" className={tab === "openings" ? "on" : ""} onClick={() => setTab("openings")} disabled={!session} aria-current={tab === "openings" ? "page" : undefined}><Icon name="people" size={19}/><span>Openings</span>{pending > 0 && <i className="dash-dot" aria-label={`${pending} to decide`}/>}</button>
      {admin && <button type="button" className={tab === "clubs" ? "on" : ""} onClick={() => setTab("clubs")} aria-current={tab === "clubs" ? "page" : undefined}><Icon name="shield" size={19}/><span>Clubs</span></button>}
      <span className="dash-rail-end" title={session ? `${clubName} · signed in` : "Not signed in"}>{session ? initials : "?"}</span>
    </nav>
    <div className="dash-main">
      <div className="dash-bar">
        {session && <span className="dash-club-tile" aria-hidden="true">{initials}</span>}
        <div className="dash-title">
          <h1>{session ? clubName : "Club dashboard"}</h1>
          {session && <p>{club?.verified !== false && <span className="dash-verified"><Icon name="shield" size={13}/> Verified issuer</span>}{term && <span>{term}</span>}<button className="dash-lock" onClick={lock}>Lock</button></p>}
        </div>
        <span className="dash-spacer"/>
        {session && tab === "events" && <>
          <button className="button secondary" onClick={() => setAward(null)}><Icon name="spark" size={16}/> Award a badge</button>
          <button className="button primary" onClick={openCreate}><Icon name="plus" size={16}/> New event</button>
        </>}
      </div>

      {!session && sessionChecked && <div className="dash-signin">
        <Icon name="shield" size={22}/>
        <div><strong>Sign in to your club</strong><span>Use your club’s passcode to create events, run check-in and see who showed up.</span></div>
        <button className="button primary" onClick={openAccess}>Enter passcode <Icon name="arrow" size={15}/></button>
      </div>}

      {session && tab === "events" && <>
        <div className="dash-kpis">
          <span><strong>{events === null ? "–" : hosted.length}</strong> {hosted.length === 1 ? "event" : "events"}</span>
          <span><strong>{checkins ?? "–"}</strong> check-ins</span>
          <span><strong>{events === null ? "–" : badges}</strong> {badges === 1 ? "role badge" : "role badges"}</span>
          {pending > 0 && <button className="dash-pending" onClick={() => setTab("openings")}>{pending} {pending === 1 ? "application" : "applications"} to decide →</button>}
        </div>
        {events === null && <ul className="dash-list">{[0, 1, 2].map((i) => <li className="dash-row" key={i}><div className="skeleton" style={{height: 14, width: "40%"}}/></li>)}</ul>}
        {events !== null && events.length === 0 && <p className="dash-empty">{loadError ? "Couldn’t load events. Refresh to try again." : "No events yet. Create one to get a check-in QR code."}</p>}
        {upcoming.length > 0 && <><h2 className="dash-h">Next</h2><ul className="dash-list">{upcoming.map((e, i) => eventRow(e, i === 0))}</ul></>}
        {past.length > 0 && <><h2 className="dash-h">Past</h2><ul className="dash-list">{past.map((e) => eventRow(e))}</ul></>}
      </>}

      {session && tab === "openings" && <OpeningsPanel session={session} club={club} />}
      {session && admin && tab === "clubs" && <ClubsPanel adminPassword={session.password} />}
    </div>
  </main>
  {award !== false && session && <AwardModal session={session} existing={award ?? undefined} onClose={() => setAward(false)} onChanged={loadEvents} />}
  {accessModal && <OrganizerAccessModal initialError={accessError} onClose={()=>setAccessModal(false)} onUnlocked={onUnlocked} />}
  {createModal && <div className="modal-overlay" onClick={()=>!createBusy && setCreateModal(false)}><form role="dialog" aria-modal="true" aria-label="Create event" className="modal" onClick={e=>e.stopPropagation()} onSubmit={submitCreate}><button type="button" className="modal-close" aria-label="Close" disabled={createBusy} onClick={()=>setCreateModal(false)}>×</button><span className="eyebrow">MAKE ROOM FOR SOMETHING GOOD</span><h2>A reason to show up.</h2><p>Create an event for your community.</p><label className="field">Event name<input value={name} maxLength={80} placeholder="e.g. Builders Meeting" onChange={e=>setName(e.target.value)}/></label><div className="form-columns"><label className="field">Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label className="field">Time<input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label></div><label className="field">Location<input value={location} maxLength={80} placeholder="e.g. UBC Nest, Room 2504 (optional)" onChange={e=>setLocation(e.target.value)}/></label><button type="submit" className="button primary full" disabled={createBusy}>{createBusy ? "Creating event token…" : "Create event"} <Icon name="arrow" size={16}/></button>{createError && <p className="form-error" role="alert">{createError}</p>}<small>Creates a nontransferable Token-2022 token on Solana devnet. The organizer wallet pays the fee. Takes a few seconds.</small></form></div>}
  </>;
}
