"use client";

import Link from "next/link";
import React, { useState, useEffect } from "react";
import { Icon } from "@/components/Icon";
import { Badge } from "@/components/Badge";
import { AttendanceCard } from "@/components/AttendanceCard";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { dateTile, formatEventDetail, isToday } from "@/lib/format";
import { explorerLink } from "@/lib/solana";
import { formatClosingDay, ruleSentence, type OpeningInfo } from "@/lib/openings";

interface HomeEvent {
  id: string;
  name: string;
  date: string;
  location?: string;
  mint: string;
}

type HomeOpening = Pick<OpeningInfo, "id" | "title" | "clubName" | "role" | "minCount" | "closesAt">;

export default function HomeView({ events, openings = [] }: { events: HomeEvent[]; openings?: HomeOpening[] }) {
  const [clientNow, setClientNow] = useState<Date | null>(null);
  useEffect(() => { setClientNow(new Date()); }, []);

  // Build a date string for "past/coming up" comparisons — only after mount.
  const todayStr = clientNow
    ? `${clientNow.getFullYear()}-${String(clientNow.getMonth() + 1).padStart(2, "0")}-${String(clientNow.getDate()).padStart(2, "0")}`
    : null;

  // Newest first; the three most recent events.
  const recent = [...events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);

  return <><SiteHeader view="home" />
  <main className="shell">
    <section className="hero"><div className="hero-copy"><Badge>Small moments. Lasting proof.</Badge><h1>Every time you<br/>show up.<br/><span>It adds up.</span></h1><p>Your time matters. Turn every club meeting into a little proof of belonging. Yours to keep, wherever you go.</p><div className="actions"><Link className="button primary" href="/profile/me">View my attendance <Icon name="arrow" size={17}/></Link><Link className="text-link" href="/organizer">Host an event <Icon name="arrow" size={16}/></Link></div><div className="hero-note"><span>Good people. Real connections.<br/><strong>One meeting at a time.</strong></span></div></div><div className="hero-art"><div className="back-card back-one"/><div className="back-card back-two"/><AttendanceCard/><div className="floating-note"><span className="note-check"><Icon name="check" size={16}/></span><div>Another meeting. Another milestone.<small>Your fifth event unlocked Core Member.</small></div></div><span className="art-caption"><Icon name="shield" size={13}/> Yours to keep. Never to trade.</span></div></section>
    <section className="benefit-strip"><div><Icon name="shield"/><span>Proof that stays with you<small>Attendance you own, in your wallet.</small></span></div><div><Icon name="wallet"/><span>Just bring yourself<small>No fees. No SOL needed.</small></span></div><div><Icon name="spark"/><span>Consistency opens doors<small>Show up. Unlock your next chapter.</small></span></div></section>
    {recent.length > 0 && <section className="events-section"><div className="section-heading"><div><span className="eyebrow">YOUR COMMUNITY, IN MOTION</span><h2>Make your next appearance.</h2></div><Link className="text-link" href="/profile/me">View my attendance <Icon name="arrow" size={16}/></Link></div><div className="event-grid">{recent.map((e, i) => { const tile = dateTile(e.date); const today = clientNow ? isToday(e.date, clientNow) : false; const isPast = todayStr !== null && e.date.slice(0, 10) < todayStr; return <a href={explorerLink(e.mint)} target="_blank" rel="noreferrer" className="event-card" key={e.id} style={{"--card-i": i} as React.CSSProperties}><div className="event-card-top"><div className="date-tile"><small>{tile.month}</small>{tile.day}</div>{today ? <Badge>Checking in today</Badge> : <span className="quiet-pill"><Icon name="calendar" size={12}/> {isPast ? "Past event" : "Coming up"}</span>}</div><h3>{e.name}</h3><p>{today ? "Scan the QR code in the room to check in." : "Each attendee holds one nontransferable token."}</p><div className="event-card-bottom"><span>{formatEventDetail(e.date, e.location, clientNow ?? undefined)}</span><span className="event-card-proof">View token <Icon name="external" size={15}/></span></div></a>; })}</div></section>}
    {openings.length > 0 && <section className="events-section openings-section"><div className="section-heading"><div><span className="eyebrow">YOUR TRACK RECORD, PUT TO WORK</span><h2>Open right now.</h2></div><Link className="text-link" href="/profile/me">View my track record <Icon name="arrow" size={16}/></Link></div><div className="event-grid">{openings.map((o, i) => <Link href={`/openings/${o.id}`} className="event-card" key={o.id} style={{"--card-i": i} as React.CSSProperties}><div className="event-card-top"><Badge>{o.clubName}</Badge><span className="quiet-pill"><Icon name="calendar" size={12}/> {o.closesAt && clientNow ? `Open until ${formatClosingDay(o.closesAt)}` : "Open"}</span></div><h3>{o.title}</h3><p>{ruleSentence(o.role, o.minCount)}</p><div className="event-card-bottom"><span>Checked against your badges on Solana</span><span className="event-card-proof">See if you qualify <Icon name="arrow" size={15}/></span></div></Link>)}</div></section>}
    <section className="closing"><span className="little-mark">↗</span><div><h2>Presence has its perks.</h2><p>One event gets you started. Coming back makes you a regular.</p></div><Link href="/profile/me" className="button secondary">Explore your membership <Icon name="arrow" size={16}/></Link></section>
  </main><SiteFooter /></>;
}
